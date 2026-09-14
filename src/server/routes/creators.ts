import { Web } from "@rabbit-company/web";
import { bodyLimit } from "@rabbit-company/web-middleware/body-limit";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isImageTypeSupported, isOtpValid, isSocialValid, isUsernameValid } from "../lib/validation.ts";
import { uuid, verifyPassword } from "../lib/crypto.ts";
import { avatarKey, avatarUrl, storage } from "../lib/storage.ts";
import {
	findCreator,
	isEmailVerified,
	isSuspended,
	listCreators,
	parseThemeColors,
	toPublicCreator,
	updateAvatarType,
	updateSettings,
	updateSocial,
} from "../db/creators.ts";
import { listPublishedByCreator, toPublicSummary } from "../db/posts.ts";
import { findAvatarMedia, replaceAvatarMedia } from "../db/media.ts";
import { assertStorageAvailable } from "../lib/quota.ts";
import { purgeCreator } from "../lib/purge.ts";
import { verifyOtp, isTwoFactorEnabled } from "../auth/twofactor.ts";
import { requireOwner } from "../middleware/auth.ts";
import { invalidateCreator, publicCache } from "../middleware/cache.ts";
import { validateSettings } from "./shared.ts";
import { clearSessionCookie } from "../lib/cookies.ts";
import { findCustomization, saveCustomization } from "../db/customizations.ts";
import { validateCustomization } from "../lib/customization.ts";
import type { AppState } from "../types.ts";
import { accountRateLimit } from "../middleware/account-rate-limit.ts";

export function creatorRoutes(app: Web<AppState>): void {
	app.post("/api/v1/creators/me/settings", requireOwner(), accountRateLimit("creators.settings.update", "write"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["title", "description", "author", "category", "language", "theme"]);

		const creator = ctx.get("creator");
		const settings = validateSettings(body, parseThemeColors(creator.theme_colors));
		const username = creator.username;
		await updateSettings(username, settings);
		invalidateCreator(username);
		return ok(ctx, settings);
	});

	app.get("/api/v1/creators/me/customization", requireOwner(), accountRateLimit("creators.customization.read", "read"), async (ctx) => {
		return ok(ctx, await findCustomization(ctx.get("creator").username));
	});

	app.post("/api/v1/creators/me/customization", requireOwner(), accountRateLimit("creators.customization.update", "write"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const customization = validateCustomization(body);
		const username = ctx.get("creator").username;
		const saved = await saveCustomization(username, customization);
		invalidateCreator(username);
		return ok(ctx, saved);
	});

	app.post("/api/v1/creators/me/social", requireOwner(), accountRateLimit("creators.social.update", "write"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["social"]);

		assertValid(body.social, isSocialValid, ErrorCode.INVALID_SOCIAL);
		const username = ctx.get("creator").username;
		await updateSocial(username, body.social);
		invalidateCreator(username);
		return ok(ctx, { social: body.social });
	});

	app.put(
		"/api/v1/creators/me/avatar",
		requireOwner(),
		accountRateLimit("creators.avatar.upload", "upload"),
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
			invalidateCreator(username);

			return ok(ctx, { url: avatarUrl(username) });
		},
	);

	app.delete("/api/v1/creators/me", requireOwner(), accountRateLimit("creators.account.delete", "critical"), async (ctx) => {
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
