import { Web } from "@rabbit-company/web";
import { rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isEmailValid, isOtpValid, isPasswordValid, isUsernameValid } from "../lib/validation.ts";
import { hashPassword, passwordEntropy, verifyPassword, decrypt, encrypt } from "../lib/crypto.ts";
import { creatorExists, findCreator, insertCreator, toPublicCreator, touchAccessed, updateAvatarType, updatePassword, isSuspended } from "../db/creators.ts";
import { deleteOtherSessions, deleteSessionByPrefix, deleteSessionsByCreator } from "../db/sessions.ts";
import { createSession, revokeSession, summarizeSessions } from "../auth/sessions.ts";
import {
	beginTwoFactor,
	confirmTwoFactor,
	disableTwoFactor,
	isTwoFactorEnabled,
	regenerateBackupCodes,
	remainingBackupCodes,
	verifyOtp,
} from "../auth/twofactor.ts";
import { requireAuth } from "../middleware/auth.ts";
import { storage, avatarKey } from "../lib/storage.ts";
import { clearSessionCookie, sessionCookie } from "../lib/cookies.ts";
import { DEFAULT_AVATAR_SVG } from "../lib/default-avatar.ts";
import { recordAvatar } from "../lib/media-sync.ts";
import { validateSettings } from "./shared.ts";
import type { AppState } from "../types.ts";

const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

interface PendingEnrollment {
	username: string;
	secret: string;
	backupCodes: string[];
	exp: number;
}

export function authRoutes(app: Web<AppState>): void {
	/**
	 * Credential endpoints are the ones worth brute-forcing, so they get a
	 * tighter budget than the global limit: 10 attempts per 15 minutes per IP.
	 */
	const credentialLimit = rateLimit<AppState>({
		windowMs: 15 * 60 * 1000,
		max: 10,
		message: "Too many attempts. Please try again later.",
		statusCode: 429,
	});

	app.post("/api/v1/auth/register", credentialLimit, async (ctx) => {
		if (!config.limits.registrationEnabled) throw new ApiError(ErrorCode.REGISTRATION_DISABLED);

		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["username", "password", "email", "title", "description", "author", "category", "language", "theme"]);

		assertValid(body.username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		assertValid(body.password, isPasswordValid, ErrorCode.INVALID_PASSWORD);
		assertValid(body.email, isEmailValid, ErrorCode.INVALID_EMAIL);

		const entropy = passwordEntropy(body.password);
		if (entropy < config.limits.minPasswordEntropy) {
			throw new ApiError(
				ErrorCode.PASSWORD_TOO_WEAK,
				`Password entropy is ${Math.round(entropy)} bits, but at least ${config.limits.minPasswordEntropy} is required.`,
				{ entropy: Math.round(entropy), required: config.limits.minPasswordEntropy },
			);
		}

		const settings = validateSettings(body);

		if (await creatorExists(body.username)) throw new ApiError(ErrorCode.USERNAME_TAKEN);

		await insertCreator({
			username: body.username,
			password: await hashPassword(body.password),
			email: body.email,
			...settings,
		});

		try {
			// An avatar can already exist under this username when the bucket
			// outlives the database, as after pointing a fresh install at storage
			// that is already in use. Writing the placeholder over it would
			// destroy the real one, so it is only written when nothing is there.
			if (!(await storage.exists(avatarKey(body.username)))) {
				await storage.put(avatarKey(body.username), DEFAULT_AVATAR_SVG, "image/svg+xml");
				await updateAvatarType(body.username, "image/svg+xml");
			}

			// Record it now rather than leaving it for a later sync to discover,
			// so reported usage matches the bucket from the first page load.
			await recordAvatar(body.username);
		} catch {
			// A missing placeholder is cosmetic, and the account already exists.
		}

		return ok(ctx, { username: body.username }, 201);
	});

	app.post("/api/v1/auth/login", credentialLimit, async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["username", "password"]);

		assertValid(body.username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		if (typeof body.password !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);

		const creator = await findCreator(body.username);

		// Hash even when the account is unknown, so a missing username and a
		// wrong password take comparable time and cannot be told apart.
		const stored = creator?.password ?? "$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const passwordOk = await verifyPassword(body.password, stored);

		if (!creator || !passwordOk) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		// Checked after the password, so suspension is not discoverable by
		// anyone who does not already hold the credentials.
		if (isSuspended(creator)) throw new ApiError(ErrorCode.ACCOUNT_SUSPENDED);

		if (isTwoFactorEnabled(creator)) {
			if (body.otp === undefined || body.otp === null || body.otp === "") throw new ApiError(ErrorCode.OTP_REQUIRED);
			assertValid(body.otp, isOtpValid, ErrorCode.INVALID_OTP);
			if (!(await verifyOtp(creator, body.otp))) throw new ApiError(ErrorCode.INVALID_OTP);
		}

		const session = await createSession(creator.username, ctx.clientIp, ctx.req.headers.get("User-Agent") ?? undefined);
		await touchAccessed(creator.username, creator.accessed_at);

		ctx.header("Set-Cookie", sessionCookie(session.token, config.limits.sessionTtl));

		return ok(ctx, {
			token: session.token,
			expiresAt: session.expiresAt,
			creator: toPublicCreator(creator),
		});
	});

	app.post("/api/v1/auth/logout", requireAuth(), async (ctx) => {
		await revokeSession(ctx.get("token"));
		ctx.header("Set-Cookie", clearSessionCookie());
		return ok(ctx);
	});

	app.get("/api/v1/auth/me", requireAuth(), (ctx) => {
		const creator = ctx.get("creator");
		return ok(ctx, {
			creator: toPublicCreator(creator),
			backupCodesRemaining: remainingBackupCodes(creator),
		});
	});

	app.get("/api/v1/auth/sessions", requireAuth(), async (ctx) => {
		return ok(ctx, { sessions: await summarizeSessions(ctx.get("creator").username, ctx.get("token")) });
	});

	app.delete("/api/v1/auth/sessions/:id", requireAuth(), async (ctx) => {
		const removed = await deleteSessionByPrefix(ctx.get("creator").username, ctx.params.id ?? "");
		if (removed === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No such session.");
		return ok(ctx);
	});

	app.delete("/api/v1/auth/sessions", requireAuth(), async (ctx) => {
		await deleteOtherSessions(ctx.get("creator").username, ctx.get("session").id);
		return ok(ctx);
	});

	app.post("/api/v1/auth/password", requireAuth(), credentialLimit, async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["currentPassword", "newPassword"]);

		const creator = ctx.get("creator");
		if (typeof body.currentPassword !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);
		if (!(await verifyPassword(body.currentPassword, creator.password))) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		assertValid(body.newPassword, isPasswordValid, ErrorCode.INVALID_PASSWORD);
		const entropy = passwordEntropy(body.newPassword);
		if (entropy < config.limits.minPasswordEntropy) {
			throw new ApiError(ErrorCode.PASSWORD_TOO_WEAK, undefined, {
				entropy: Math.round(entropy),
				required: config.limits.minPasswordEntropy,
			});
		}

		await updatePassword(creator.username, await hashPassword(body.newPassword));

		// A password change should end every other session, including any an
		// attacker may hold. The current one is re-issued below.
		await deleteSessionsByCreator(creator.username);
		const session = await createSession(creator.username, ctx.clientIp, ctx.req.headers.get("User-Agent") ?? undefined);

		ctx.header("Set-Cookie", sessionCookie(session.token, config.limits.sessionTtl));

		return ok(ctx, { token: session.token, expiresAt: session.expiresAt });
	});

	app.post("/api/v1/auth/2fa/begin", requireAuth(), (ctx) => {
		const creator = ctx.get("creator");
		if (isTwoFactorEnabled(creator)) throw new ApiError(ErrorCode.TWO_FACTOR_ALREADY_ENABLED);

		const enrollment = beginTwoFactor(creator.username);
		const pending: PendingEnrollment = {
			username: creator.username,
			secret: enrollment.secret,
			backupCodes: enrollment.backupCodes,
			exp: Date.now() + ENROLLMENT_TTL_MS,
		};

		return ok(ctx, {
			secret: enrollment.secret,
			uri: enrollment.uri,
			backupCodes: enrollment.backupCodes,
			enrollment: encrypt(JSON.stringify(pending)),
		});
	});

	app.post("/api/v1/auth/2fa/confirm", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["enrollment", "code"]);

		const creator = ctx.get("creator");
		if (isTwoFactorEnabled(creator)) throw new ApiError(ErrorCode.TWO_FACTOR_ALREADY_ENABLED);

		if (typeof body.enrollment !== "string") throw new ApiError(ErrorCode.INVALID_OTP, "Enrolment is invalid. Start again.");
		const raw = decrypt(body.enrollment);
		if (raw === null) throw new ApiError(ErrorCode.INVALID_OTP, "Enrolment is invalid. Start again.");

		let pending: PendingEnrollment;
		try {
			pending = JSON.parse(raw) as PendingEnrollment;
		} catch {
			throw new ApiError(ErrorCode.INVALID_OTP, "Enrolment is invalid. Start again.");
		}

		if (pending.username !== creator.username || pending.exp < Date.now()) {
			throw new ApiError(ErrorCode.INVALID_OTP, "Enrolment has expired. Start again.");
		}

		assertValid(body.code, isOtpValid, ErrorCode.INVALID_OTP);
		if (!(await confirmTwoFactor(creator.username, pending.secret, pending.backupCodes, body.code))) {
			throw new ApiError(ErrorCode.INVALID_OTP);
		}

		return ok(ctx, { backupCodes: pending.backupCodes });
	});

	app.post("/api/v1/auth/2fa/disable", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["password", "otp"]);

		const creator = ctx.get("creator");
		if (!isTwoFactorEnabled(creator)) throw new ApiError(ErrorCode.TWO_FACTOR_NOT_ENABLED);

		if (typeof body.password !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);
		if (!(await verifyPassword(body.password, creator.password))) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		assertValid(body.otp, isOtpValid, ErrorCode.INVALID_OTP);
		if (!(await verifyOtp(creator, body.otp))) throw new ApiError(ErrorCode.INVALID_OTP);

		await disableTwoFactor(creator.username);
		return ok(ctx);
	});

	app.post("/api/v1/auth/2fa/backup-codes", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["password", "otp"]);

		const creator = ctx.get("creator");
		if (!isTwoFactorEnabled(creator)) throw new ApiError(ErrorCode.TWO_FACTOR_NOT_ENABLED);

		if (typeof body.password !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);
		if (!(await verifyPassword(body.password, creator.password))) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		assertValid(body.otp, isOtpValid, ErrorCode.INVALID_OTP);
		if (!(await verifyOtp(creator, body.otp))) throw new ApiError(ErrorCode.INVALID_OTP);

		return ok(ctx, { backupCodes: await regenerateBackupCodes(creator) });
	});
}
