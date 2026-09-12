import { Web } from "@rabbit-company/web";
import { bodyLimit } from "@rabbit-company/web-middleware/body-limit";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isImageTypeSupported, isOtpValid, isSocialValid, isUsernameValid } from "../lib/validation.ts";
import { uuid, verifyPassword } from "../lib/crypto.ts";
import { avatarKey, avatarUrl, storage } from "../lib/storage.ts";
import { findCreator, isEmailVerified, isSuspended, listCreators, toPublicCreator, updateAvatarType, updateSettings, updateSocial } from "../db/creators.ts";
import { listPublishedByCreator, toPublicSummary } from "../db/posts.ts";
import { findAvatarMedia, replaceAvatarMedia } from "../db/media.ts";
import { assertStorageAvailable } from "../lib/quota.ts";
import { purgeCreator } from "../lib/purge.ts";
import { verifyOtp, isTwoFactorEnabled } from "../auth/twofactor.ts";
import { requireOwner } from "../middleware/auth.ts";
import { publicCache } from "../middleware/cache.ts";
import { validateSettings } from "./shared.ts";
import { clearSessionCookie } from "../lib/cookies.ts";
import type { AppState } from "../types.ts";

export function creatorRoutes(app: Web<AppState>): void {
	app.post("/api/v1/creators/me/settings", requireOwner(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["title", "description", "author", "category", "language", "theme"]);

		const settings = validateSettings(body);
		await updateSettings(ctx.get("creator").username, settings);
		return ok(ctx, settings);
	});

	app.post("/api/v1/creators/me/social", requireOwner(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["social"]);

		assertValid(body.social, isSocialValid, ErrorCode.INVALID_SOCIAL);
		await updateSocial(ctx.get("creator").username, body.social);
		return ok(ctx, { social: body.social });
	});

	app.put(
		"/api/v1/creators/me/avatar",
		requireOwner(),
		bodyLimit<AppState>({ maxSize: config.limits.maxAvatarSize, message: "Avatars can't be larger than 300 kB." }),
		async (ctx) => {
			const contentType = ctx.req.headers.get("Content-Type");
			if (contentType === null) throw new ApiError(ErrorCode.MISSING_CONTENT_TYPE);
			assertValid(contentType, isImageTypeSupported, ErrorCode.UNSUPPORTED_FILE_TYPE);

			const data = await ctx.req.arrayBuffer();
			if (data.byteLength === 0) throw new ApiError(ErrorCode.STORAGE_ERROR, "Empty upload.");
			if (data.byteLength > config.limits.maxAvatarSize) throw new ApiError(ErrorCode.FILE_TOO_LARGE);

			const username = ctx.get("creator").username;

			const previous = await findAvatarMedia(username);
			await assertStorageAvailable(username, data.byteLength, previous?.size ?? 0);

			await storage.put(avatarKey(username), data, contentType);
			await updateAvatarType(username, contentType);
			await replaceAvatarMedia(uuid(), username, contentType, data.byteLength);

			return ok(ctx, { url: avatarUrl(username) });
		},
	);

	app.delete("/api/v1/creators/me", requireOwner(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["password"]);

		const creator = ctx.get("creator");
		if (typeof body.password !== "string") throw new ApiError(ErrorCode.INVALID_PASSWORD);
		if (!(await verifyPassword(body.password, creator.password))) throw new ApiError(ErrorCode.INVALID_CREDENTIALS);

		if (isTwoFactorEnabled(creator)) {
			assertValid(body.otp, isOtpValid, ErrorCode.INVALID_OTP);
			if (!(await verifyOtp(creator, body.otp))) throw new ApiError(ErrorCode.INVALID_OTP);
		}

		await purgeCreator(creator.username, "self-service");

		ctx.header("Set-Cookie", clearSessionCookie());
		return ok(ctx);
	});

	app.get("/api/v1/creators", publicCache(), async (ctx) => {
		const creators = await listCreators(100);
		return ok(ctx, {
			creators: creators.map((row) => ({
				username: row.username,
				title: row.title,
				description: row.description,
				author: row.author,
				category: row.category,
				language: row.language,
				avatar: avatarUrl(row.username),
			})),
		});
	});

	app.get("/api/v1/creators/:username", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);

		const creator = await findCreator(username);
		if (!creator || isSuspended(creator) || !isEmailVerified(creator)) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);

		// Published only, filtered in SQL. This endpoint is public, so using the
		// panel's list here would expose every draft the creator has.
		const posts = await listPublishedByCreator(username);

		const { email: _email, membership: _membership, ...profile } = toPublicCreator(creator);
		return ok(ctx, {
			creator: { ...profile, avatar: avatarUrl(username) },
			posts: posts.map(toPublicSummary),
		});
	});
}
