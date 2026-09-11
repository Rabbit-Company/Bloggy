import { now, sql } from "./index.ts";

export type MediaKind = "avatar" | "image";

export interface MediaRow {
	id: string;
	username: string;
	kind: MediaKind;
	content_type: string;
	size: number;
	created_at: string;
}

export interface MediaItem {
	id: string;
	kind: MediaKind;
	contentType: string;
	size: number;
	createdAt: string;
	url: string;
}

export async function insertMedia(item: Omit<MediaRow, "created_at"> & { created_at?: string }): Promise<MediaRow> {
	const row: MediaRow = { ...item, created_at: item.created_at ?? now() };
	await sql`INSERT INTO media ${sql({ ...row })}`;
	return row;
}

export async function findMedia(id: string): Promise<MediaRow | null> {
	const rows = (await sql`SELECT * FROM media WHERE id = ${id}`) as MediaRow[];
	return rows[0] ?? null;
}

export async function listMedia(username: string, kind: MediaKind = "image"): Promise<MediaRow[]> {
	return (await sql`SELECT * FROM media WHERE username = ${username} AND kind = ${kind}
		ORDER BY created_at DESC`) as MediaRow[];
}

export async function listMediaByCreator(username: string): Promise<MediaRow[]> {
	return (await sql`SELECT * FROM media WHERE username = ${username}`) as MediaRow[];
}

/** The stored object is the authority on its own size, so a sync corrects drift. */
export async function updateMediaSize(id: string, size: number): Promise<void> {
	await sql`UPDATE media SET size = ${size} WHERE id = ${id}`;
}

export async function deleteMedia(id: string): Promise<void> {
	await sql`DELETE FROM media WHERE id = ${id}`;
}

export async function deleteMediaByCreator(username: string): Promise<void> {
	await sql`DELETE FROM media WHERE username = ${username}`;
}

/**
 * Summed from the rows rather than kept as a running counter on the account:
 * a counter has to be adjusted correctly by every upload and delete path, and
 * silently drifts from the truth the first time one forgets. This cannot drift,
 * and the sum is indexed by username.
 */
export async function mediaUsage(username: string): Promise<number> {
	const rows = (await sql`SELECT SUM(size) AS total FROM media WHERE username = ${username}`) as { total: number | null }[];
	return Number(rows[0]?.total ?? 0);
}

export async function findAvatarMedia(username: string): Promise<MediaRow | null> {
	const rows = (await sql`SELECT * FROM media WHERE username = ${username} AND kind = 'avatar'`) as MediaRow[];
	return rows[0] ?? null;
}

/**
 * An avatar overwrites the last at the same storage key, so its row is replaced
 * rather than added. Otherwise usage would grow with every change to a file
 * that only ever occupies one slot. Delete-then-insert instead of an upsert,
 * since `ON CONFLICT` and `ON DUPLICATE KEY` are spelled differently across the
 * four supported dialects.
 */
export async function replaceAvatarMedia(id: string, username: string, contentType: string, size: number): Promise<void> {
	await sql`DELETE FROM media WHERE username = ${username} AND kind = 'avatar'`;
	await insertMedia({ id, username, kind: "avatar", content_type: contentType, size });
}
