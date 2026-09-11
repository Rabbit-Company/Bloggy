import { deleteMedia, insertMedia, listMediaByCreator, updateMediaSize, type MediaKind, type MediaRow } from "../db/media.ts";
import { updateAvatarType } from "../db/creators.ts";
import { avatarKey, storage } from "./storage.ts";
import { isUuidValid } from "./validation.ts";
import { detectImageType, isUsableImageType } from "./image-type.ts";
import { logger } from "./logger.ts";

export interface MediaSyncResult {
	username: string;
	/** Objects in the bucket that had no row, now recorded. */
	imported: number;
	/** Rows whose object is gone from the bucket, now removed. */
	pruned: number;
	/** Object keys skipped because their name is not a usable image id. */
	skipped: string[];
	/** Stored bytes after reconciling. */
	usage: number;
}

/**
 * Makes the `media` table agree with what is actually in the bucket.
 *
 * The rewrite indexes media in the database, while the original Bloggy listed
 * the bucket on every request. Pointing a fresh install at an existing bucket
 * therefore leaves objects that exist but are invisible, and a usage figure of
 * zero. This imports what is there, drops rows whose object has gone missing,
 * and returns the recomputed usage.
 *
 * The key layout is unchanged from the original (`avatars/<username>` and
 * `images/<username>/<uuid>`), so nothing in the bucket has to move.
 */
export async function syncMediaFromStorage(username: string): Promise<MediaSyncResult> {
	const prefix = `images/${username}`;
	const [objects, rows] = await Promise.all([storage.list(prefix), listMediaByCreator(username)]);

	const known = new Map(rows.map((row) => [row.id, row]));
	const seen = new Set<string>();
	const skipped: string[] = [];
	let imported = 0;
	let usage = 0;

	for (const object of objects) {
		const id = object.key.slice(`${prefix}/`.length);

		// The serving route validates the id as a UUID, so anything else would be
		// recorded but unreachable. Report it rather than importing a dead row.
		if (!isUuidValid(id)) {
			skipped.push(object.key);
			continue;
		}

		seen.add(id);
		usage += object.size;

		const existing = known.get(id);
		if (existing !== undefined) {
			// The object is the authority on its own size.
			if (existing.size !== object.size) await updateMediaSize(id, object.size);
			continue;
		}

		await importObject(id, username, "image", object.key, object.size, object.uploadedAt);
		imported++;
	}

	const avatar = await recordAvatar(
		username,
		rows.find((row) => row.kind === "avatar"),
	);
	usage += avatar.size;
	if (avatar.id !== null) seen.add(avatar.id);
	if (avatar.imported) imported++;

	let pruned = 0;
	for (const row of rows) {
		if (seen.has(row.id)) continue;
		await deleteMedia(row.id);
		pruned++;
	}

	if (imported > 0 || pruned > 0 || skipped.length > 0) {
		logger.audit(`Media synced for ${username}`, { username, imported, pruned, skipped: skipped.length });
	}

	return { username, imported, pruned, skipped, usage };
}

/**
 * Records the object at the creator's avatar key, whatever put it there.
 *
 * Called both by a full sync and by registration, so an account's usage is
 * right from the moment it exists rather than only after someone presses
 * recalculate. The avatar sits in a prefix shared by every creator, so it is
 * fetched by its exact key instead of by listing that prefix.
 */
export async function recordAvatar(username: string, existing?: MediaRow): Promise<{ id: string | null; size: number; imported: boolean }> {
	const object = await storage.stat(avatarKey(username));
	if (object === null) return { id: null, size: 0, imported: false };

	if (existing !== undefined) {
		// The object is the authority on its own size.
		if (existing.size !== object.size) await updateMediaSize(existing.id, object.size);
		return { id: existing.id, size: object.size, imported: false };
	}

	const id = crypto.randomUUID();
	const contentType = await contentTypeOf(avatarKey(username));
	await insertMedia({ id, username, kind: "avatar", content_type: contentType, size: object.size, created_at: object.uploadedAt });

	// The media route trusts `avatar_type` over what the driver reports, so an
	// unusable value here would beat the fallback rather than lose to it.
	if (isUsableImageType(contentType)) await updateAvatarType(username, contentType);

	return { id, size: object.size, imported: true };
}

/** Only a new row needs a content type, which costs one request per object. */
async function importObject(id: string, username: string, kind: MediaKind, key: string, size: number, uploadedAt: string): Promise<void> {
	await insertMedia({ id, username, kind, content_type: await contentTypeOf(key), size, created_at: uploadedAt });
}

/**
 * The stored metadata where the driver has it, the object's own bytes where it
 * does not. Falls back to octet-stream only when neither can say.
 */
async function contentTypeOf(key: string): Promise<string> {
	const info = await storage.stat(key);
	if (info !== null && isUsableImageType(info.contentType)) return info.contentType;

	const object = await storage.get(key);
	if (object === null) return "application/octet-stream";

	const reader = object.stream.getReader();
	try {
		const { value } = await reader.read();
		const sniffed = value === undefined ? null : detectImageType(value);
		if (sniffed !== null) return sniffed;
	} finally {
		await reader.cancel();
	}

	return "application/octet-stream";
}
