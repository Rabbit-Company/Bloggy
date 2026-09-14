import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isEmailValid, isOtpValid, isPasswordValid, isUsernameValid } from "../lib/validation.ts";
import { hashPassword, passwordEntropy, verifyPassword, decrypt, encrypt } from "../lib/crypto.ts";
import {
	creatorExists,
	deleteCreator,
	findCreator,
	insertCreator,
	isEmailVerified,
	isSuspended,
	markEmailVerified,
	toPublicCreator,
	touchAccessed,
	updateAvatarType,
	updatePassword,
} from "../db/creators.ts";
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
import { requireAuth, requireOwner } from "../middleware/auth.ts";
import { findTeamMember, teamMemberExists, touchTeamMember, updateTeamMemberPassword } from "../db/team.ts";
import { consumePasswordResetToken, createPasswordResetToken, deletePasswordResetTokens, passwordResetTokenExists } from "../db/password-resets.ts";
import {
	consumeEmailConfirmationToken,
	createEmailConfirmationToken,
	deleteEmailConfirmationTokens,
	emailConfirmationTokenExists,
} from "../db/email-confirmations.ts";
import { storage, avatarKey } from "../lib/storage.ts";
import { clearSessionCookie, sessionCookie } from "../lib/cookies.ts";
import { DEFAULT_AVATAR_SVG } from "../lib/default-avatar.ts";
import { recordAvatar } from "../lib/media-sync.ts";
import { validateSettings } from "./shared.ts";
import type { AppContext, AppState } from "../types.ts";
import { emailConfirmationEnabled, passwordResetEmailEnabled, sendEmailConfirmation, sendPasswordResetEmail } from "../lib/email.ts";
import { logger } from "../lib/logger.ts";
import { invalidateCreator } from "../middleware/cache.ts";
import { panelTokenUrl } from "../lib/links.ts";
import { accountRateLimit, anonymousActionRateLimit } from "../middleware/account-rate-limit.ts";

const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

interface PendingEnrollment {
	username: string;
	secret: string;
	backupCodes: string[];
	exp: number;
}

function authenticatedCreator(ctx: AppContext) {
	const creator = ctx.get("creator");
	const actor = ctx.get("actor");
	return toPublicCreator(
		creator,
		{
			username: actor.username,
			role: actor.role,
			isOwner: actor.isOwner,
			canPublish: actor.canPublish,
			canEditAll: actor.canEditAll,
		},
		actor.member?.email ?? creator.email,
	);
}

async function resetIdentity(username: string): Promise<{ username: string; email: string } | null> {
	const owner = await findCreator(username);
	if (owner !== null) return isSuspended(owner) ? null : { username: owner.username, email: owner.email };

	const member = await findTeamMember(username);
	if (member === null) return null;
	const creator = await findCreator(member.blog_username);
	if (creator === null || isSuspended(creator)) return null;
	return { username: member.username, email: member.email };
}

function deliverInBackground(send: Promise<void>, discardToken: () => Promise<void>, failure: string): void {
	void send.catch(async (err) => {
		logger.error(failure, { error: String(err) });
		try {
			await discardToken();
		} catch (cleanupErr) {
			logger.error("Could not discard an undelivered token", { error: String(cleanupErr) });
		}
	});
}

export function authRoutes(app: Web<AppState>): void {
	app.post("/api/v1/auth/register", anonymousActionRateLimit("auth.register", "register"), async (ctx) => {
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

		if ((await creatorExists(body.username)) || (await teamMemberExists(body.username))) throw new ApiError(ErrorCode.USERNAME_TAKEN);

		const email = body.email.toLowerCase();
		const confirmationRequired = emailConfirmationEnabled();
		await insertCreator({
			username: body.username,
			password: await hashPassword(body.password),
			email,
			emailVerified: !confirmationRequired,
			...settings,
		});

		if (confirmationRequired) {
			const token = await createEmailConfirmationToken(body.username, email, config.limits.emailConfirmationTtl, 0);
			try {
				if (token === null) throw new Error("No confirmation token was issued.");
				await sendEmailConfirmation(email, panelTokenUrl("confirm-email", token), config.limits.emailConfirmationTtl);
			} catch (err) {
				await deleteEmailConfirmationTokens(body.username);
				await deleteCreator(body.username);
				logger.error("Registration confirmation delivery failed", { error: String(err) });
				throw new ApiError(ErrorCode.EMAIL_DELIVERY_FAILED);
			}
		}

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

		return ok(ctx, { username: body.username, emailConfirmationRequired: confirmationRequired }, 201);
	});

	app.post("/api/v1/auth/login", anonymousActionRateLimit("auth.login", "credential"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["username", "password"]);

		assertValid(body.username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		if (typeof body.password !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);

		const owner = await findCreator(body.username);
		const member = owner === null ? await findTeamMember(body.username) : null;
		const creator = owner ?? (member ? await findCreator(member.blog_username) : null);

		// Hash even when the account is unknown, so a missing username and a
		// wrong password take comparable time and cannot be told apart.
		const stored = owner?.password ?? member?.password ?? "$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const passwordOk = await verifyPassword(body.password, stored);

		if (!creator || !passwordOk) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		// Checked after the password, so suspension is not discoverable by
		// anyone who does not already hold the credentials.
		if (isSuspended(creator)) throw new ApiError(ErrorCode.ACCOUNT_SUSPENDED);
		if (owner !== null && !isEmailVerified(owner)) {
			if (emailConfirmationEnabled()) throw new ApiError(ErrorCode.EMAIL_NOT_CONFIRMED);
			// Do not permanently strand a pending account when an operator turns
			// SMTP off after registration.
			await markEmailVerified(owner.username);
			await deleteEmailConfirmationTokens(owner.username);
			invalidateCreator(owner.username);
		}

		if (owner !== null && isTwoFactorEnabled(owner)) {
			if (body.otp === undefined || body.otp === null || body.otp === "") throw new ApiError(ErrorCode.OTP_REQUIRED);
			assertValid(body.otp, isOtpValid, ErrorCode.INVALID_OTP);
			if (!(await verifyOtp(creator, body.otp))) throw new ApiError(ErrorCode.INVALID_OTP);
		}

		const identityUsername = owner?.username ?? member!.username;
		const session = await createSession(identityUsername, ctx.clientIp, ctx.req.headers.get("User-Agent") ?? undefined);
		if (owner !== null) await touchAccessed(owner.username, owner.accessed_at);
		else await touchTeamMember(member!.username, member!.accessed_at);

		ctx.header("Set-Cookie", sessionCookie(session.token, config.limits.sessionTtl));

		return ok(ctx, {
			token: session.token,
			expiresAt: session.expiresAt,
			creator: toPublicCreator(
				creator,
				owner !== null
					? { username: owner.username, role: "owner", isOwner: true, canPublish: true, canEditAll: true }
					: {
							username: member!.username,
							role: member!.role,
							isOwner: false,
							canPublish: member!.role === "publisher",
							canEditAll: member!.role === "editor" || member!.role === "publisher",
						},
				member?.email ?? creator.email,
			),
		});
	});

	app.post("/api/v1/auth/password-reset/request", anonymousActionRateLimit("auth.password-reset.request", "email"), async (ctx) => {
		if (!passwordResetEmailEnabled()) throw new ApiError(ErrorCode.PASSWORD_RESET_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["username"]);

		// Invalid and unknown names take the same successful path as real ones,
		// so this endpoint cannot be used to enumerate accounts.
		const identity = typeof body.username === "string" && isUsernameValid(body.username) ? await resetIdentity(body.username) : null;
		if (identity !== null) {
			const token = await createPasswordResetToken(identity.username, config.limits.passwordResetTtl);
			if (token !== null) {
				deliverInBackground(
					sendPasswordResetEmail(identity.email, panelTokenUrl("reset-password", token), config.limits.passwordResetTtl),
					() => deletePasswordResetTokens(identity.username),
					"Password reset email delivery failed",
				);
			}
		}

		return ok(ctx, { message: "If that account exists, a password reset link has been sent to its registered email." });
	});

	app.post("/api/v1/auth/email-confirmation/request", anonymousActionRateLimit("auth.email-confirmation.request", "email"), async (ctx) => {
		if (!emailConfirmationEnabled()) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["username"]);

		const creator = typeof body.username === "string" && isUsernameValid(body.username) ? await findCreator(body.username) : null;
		if (creator !== null && !isSuspended(creator) && !isEmailVerified(creator)) {
			const token = await createEmailConfirmationToken(creator.username, creator.email, config.limits.emailConfirmationTtl);
			if (token !== null) {
				deliverInBackground(
					sendEmailConfirmation(creator.email, panelTokenUrl("confirm-email", token), config.limits.emailConfirmationTtl),
					() => deleteEmailConfirmationTokens(creator.username),
					"Email confirmation delivery failed",
				);
			}
		}

		return ok(ctx, { message: "If that account needs confirmation, a new link has been sent to its registered email." });
	});

	app.post("/api/v1/auth/email-confirmation/validate", anonymousActionRateLimit("auth.email-confirmation.validate", "token"), async (ctx) => {
		if (!emailConfirmationEnabled()) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const token = body.token;
		if (typeof token !== "string" || !/^[A-Za-z0-9]{64}$/.test(token)) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_INVALID);
		if (!(await emailConfirmationTokenExists(token))) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_INVALID);
		return ok(ctx, { valid: true });
	});

	app.post("/api/v1/auth/email-confirmation/confirm", anonymousActionRateLimit("auth.email-confirmation.confirm", "token"), async (ctx) => {
		if (!emailConfirmationEnabled()) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const token = body.token;
		if (typeof token !== "string" || !/^[A-Za-z0-9]{64}$/.test(token)) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_INVALID);
		const username = await consumeEmailConfirmationToken(token);
		if (username === null) throw new ApiError(ErrorCode.EMAIL_CONFIRMATION_INVALID);
		invalidateCreator(username);
		return ok(ctx);
	});

	app.post("/api/v1/auth/password-reset/validate", anonymousActionRateLimit("auth.password-reset.validate", "token"), async (ctx) => {
		if (!passwordResetEmailEnabled()) throw new ApiError(ErrorCode.PASSWORD_RESET_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const token = body.token;
		if (typeof token !== "string" || !/^[A-Za-z0-9]{64}$/.test(token)) throw new ApiError(ErrorCode.PASSWORD_RESET_INVALID);
		if (!(await passwordResetTokenExists(token))) throw new ApiError(ErrorCode.PASSWORD_RESET_INVALID);
		return ok(ctx, { valid: true });
	});

	app.post("/api/v1/auth/password-reset/complete", anonymousActionRateLimit("auth.password-reset.complete", "credential"), async (ctx) => {
		if (!passwordResetEmailEnabled()) throw new ApiError(ErrorCode.PASSWORD_RESET_UNAVAILABLE);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["token", "password"]);
		if (typeof body.token !== "string" || !/^[A-Za-z0-9]{64}$/.test(body.token)) throw new ApiError(ErrorCode.PASSWORD_RESET_INVALID);
		assertValid(body.password, isPasswordValid, ErrorCode.INVALID_PASSWORD);
		const entropy = passwordEntropy(body.password);
		if (entropy < config.limits.minPasswordEntropy) {
			throw new ApiError(ErrorCode.PASSWORD_TOO_WEAK, undefined, {
				entropy: Math.round(entropy),
				required: config.limits.minPasswordEntropy,
			});
		}

		const changed = await consumePasswordResetToken(body.token, await hashPassword(body.password));
		if (!changed) throw new ApiError(ErrorCode.PASSWORD_RESET_INVALID);
		ctx.header("Set-Cookie", clearSessionCookie());
		return ok(ctx);
	});

	app.post("/api/v1/auth/logout", requireAuth(), accountRateLimit("auth.logout", "write"), async (ctx) => {
		await revokeSession(ctx.get("token"));
		ctx.header("Set-Cookie", clearSessionCookie());
		return ok(ctx);
	});

	app.get("/api/v1/auth/me", requireAuth(), accountRateLimit("auth.me", "read"), (ctx) => {
		const creator = ctx.get("creator");
		return ok(ctx, {
			creator: authenticatedCreator(ctx),
			backupCodesRemaining: ctx.get("actor").isOwner ? remainingBackupCodes(creator) : 0,
		});
	});

	app.get("/api/v1/auth/sessions", requireAuth(), accountRateLimit("auth.sessions.list", "read"), async (ctx) => {
		return ok(ctx, { sessions: await summarizeSessions(ctx.get("actor").username, ctx.get("token")) });
	});

	app.delete("/api/v1/auth/sessions/:id", requireAuth(), accountRateLimit("auth.sessions.revoke", "security"), async (ctx) => {
		const removed = await deleteSessionByPrefix(ctx.get("actor").username, ctx.params.id ?? "");
		if (removed === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No such session.");
		return ok(ctx);
	});

	app.delete("/api/v1/auth/sessions", requireAuth(), accountRateLimit("auth.sessions.revoke-others", "security"), async (ctx) => {
		await deleteOtherSessions(ctx.get("actor").username, ctx.get("session").id);
		return ok(ctx);
	});

	app.post("/api/v1/auth/password", requireAuth(), accountRateLimit("auth.password.change", "security"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["currentPassword", "newPassword"]);

		const creator = ctx.get("creator");
		const actor = ctx.get("actor");
		const account = actor.member ?? creator;
		if (typeof body.currentPassword !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);
		if (!(await verifyPassword(body.currentPassword, account.password))) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		assertValid(body.newPassword, isPasswordValid, ErrorCode.INVALID_PASSWORD);
		const entropy = passwordEntropy(body.newPassword);
		if (entropy < config.limits.minPasswordEntropy) {
			throw new ApiError(ErrorCode.PASSWORD_TOO_WEAK, undefined, {
				entropy: Math.round(entropy),
				required: config.limits.minPasswordEntropy,
			});
		}

		const password = await hashPassword(body.newPassword);
		if (actor.isOwner) await updatePassword(actor.username, password);
		else await updateTeamMemberPassword(actor.username, password);
		await deletePasswordResetTokens(actor.username);

		// A password change should end every other session, including any an
		// attacker may hold. The current one is re-issued below.
		await deleteSessionsByCreator(actor.username);
		const session = await createSession(actor.username, ctx.clientIp, ctx.req.headers.get("User-Agent") ?? undefined);

		ctx.header("Set-Cookie", sessionCookie(session.token, config.limits.sessionTtl));

		return ok(ctx, { token: session.token, expiresAt: session.expiresAt });
	});

	app.post("/api/v1/auth/2fa/begin", requireOwner(), accountRateLimit("auth.2fa.begin", "security"), (ctx) => {
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

	app.post("/api/v1/auth/2fa/confirm", requireOwner(), accountRateLimit("auth.2fa.confirm", "security"), async (ctx) => {
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

	app.post("/api/v1/auth/2fa/disable", requireOwner(), accountRateLimit("auth.2fa.disable", "security"), async (ctx) => {
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

	app.post("/api/v1/auth/2fa/backup-codes", requireOwner(), accountRateLimit("auth.2fa.backup-codes", "security"), async (ctx) => {
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
