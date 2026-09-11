import { Web } from "@rabbit-company/web";
import { bodyLimit } from "@rabbit-company/web-middleware/body-limit";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { ok } from "../lib/response.ts";
import { assertValid, isImageTypeSupported, isUsernameValid, isUuidValid } from "../lib/validation.ts";
import { uuid } from "../lib/crypto.ts";
import { avatarKey, imageKey, mediaUrl, storage } from "../lib/storage.ts";
import { deleteMedia, findMedia, insertMedia, listMedia, type MediaItem } from "../db/media.ts";
import { assertStorageAvailable, storageQuota } from "../lib/quota.ts";
import { findCreator } from "../db/creators.ts";
import { requireAuth } from "../middleware/auth.ts";
import type { AppState } from "../types.ts";

const MEDIA_MAX_AGE = 604_800; // 7 days

export function mediaRoutes(app: Web<AppState>): void {
	app.put(
		"/api/v1/media",
		requireAuth(),
		bodyLimit<AppState>({ maxSize: config.limits.maxImageSize, message: "Images can't be larger than 1 MB." }),
		async (ctx) => {
			const contentType = ctx.req.headers.get("Content-Type");
			if (contentType === null) throw new ApiError(ErrorCode.MISSING_CONTENT_TYPE);
			assertValid(contentType, isImageTypeSupported, ErrorCode.UNSUPPORTED_FILE_TYPE);

			const data = await ctx.req.arrayBuffer();
			if (data.byteLength === 0) throw new ApiError(ErrorCode.STORAGE_ERROR, "Empty upload.");
			if (data.byteLength > config.limits.maxImageSize) throw new ApiError(ErrorCode.FILE_TOO_LARGE);

			const username = ctx.get("creator").username;

			await assertStorageAvailable(username, data.byteLength);

			const id = uuid();
			await storage.put(imageKey(username, id), data, contentType);
			const row = await insertMedia({
				id,
				username,
				kind: "image",
				content_type: contentType,
				size: data.byteLength,
			});

			return ok(ctx, toMediaItem(row.id, username, row.content_type, row.size, row.created_at), 201);
		},
	);

	app.get("/api/v1/media", requireAuth(), async (ctx) => {
		const username = ctx.get("creator").username;
		const [rows, quota] = await Promise.all([listMedia(username, "image"), storageQuota(username)]);

		return ok(ctx, {
			usage: quota.used,
			limit: quota.limit,
			images: rows.map((row) => toMediaItem(row.id, username, row.content_type, row.size, row.created_at)),
		});
	});

	app.delete("/api/v1/media/:id", requireAuth(), async (ctx) => {
		const id = ctx.params.id ?? "";
		assertValid(id, isUuidValid, ErrorCode.INVALID_IMAGE_NAME);

		const username = ctx.get("creator").username;
		const row = await findMedia(id);
		// Report a missing row and someone else's row identically, so this
		// cannot be used to probe which ids exist.
		if (!row || row.username !== username) throw new ApiError(ErrorCode.NOT_FOUND, "No such image.");

		await storage.delete(imageKey(username, id));
		await deleteMedia(id);

		return ok(ctx);
	});

	app.get("/media/avatars/:username", async (ctx) => {
		const username = ctx.params.username ?? "";
		assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);

		const object = await storage.get(avatarKey(username));
		if (!object) throw new ApiError(ErrorCode.NOT_FOUND, "No such avatar.");

		// The recorded MIME type is authoritative. Avatar keys carry no file
		// extension, so a local file reports "application/octet-stream", which
		// is truthy and would otherwise win, leaving browsers unable to render
		// the image.
		const creator = await findCreator(username);
		const detected = object.contentType === "application/octet-stream" ? undefined : object.contentType;
		const contentType = creator?.avatar_type ?? detected ?? "image/svg+xml";

		return serve(object.stream, contentType, object.size);
	});

	app.get("/media/images/:username/:id", async (ctx) => {
		const username = ctx.params.username ?? "";
		const id = ctx.params.id ?? "";
		assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		assertValid(id, isUuidValid, ErrorCode.INVALID_IMAGE_NAME);

		const row = await findMedia(id);
		if (!row || row.username !== username) throw new ApiError(ErrorCode.NOT_FOUND, "No such image.");

		const object = await storage.get(imageKey(username, id));
		if (!object) throw new ApiError(ErrorCode.NOT_FOUND, "No such image.");

		return serve(object.stream, row.content_type, object.size);
	});
}

function toMediaItem(id: string, username: string, contentType: string, size: number, createdAt: string): MediaItem {
	return {
		id,
		kind: "image",
		contentType,
		size,
		createdAt,
		url: mediaUrl(imageKey(username, id)),
	};
}

function serve(stream: ReadableStream, contentType: string, size: number): Response {
	return new Response(stream, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(size),
			"Cache-Control": `public, max-age=${MEDIA_MAX_AGE}`,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
