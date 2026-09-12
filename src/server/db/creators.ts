import { now, sql, today } from "./index.ts";
import type { TeamRole } from "../../shared/constants.ts";

export interface CreatorRow {
	username: string;
	password: string;
	email: string;
	email_verified_at: string | null;
	totp_secret: string | null;
	backup_codes: string | null;
	title: string;
	description: string;
	author: string;
	category: string;
	language: string;
	social: string | null;
	theme: string;
	avatar_type: string | null;
	created_at: string;
	accessed_at: string;
	is_admin: number;
	/** When the account was suspended, or null while it is active. */
	suspended_at: string | null;
}

export interface Creator {
	username: string;
	email: string;
	title: string;
	description: string;
	author: string;
	category: string;
	language: string;
	social: Record<string, string>;
	theme: string;
	twoFactorEnabled: boolean;
	createdAt: string;
	accessedAt: string;
	isAdmin: boolean;
	suspendedAt: string | null;
	membership: {
		username: string;
		role: "owner" | TeamRole;
		isOwner: boolean;
		canPublish: boolean;
		canEditAll: boolean;
	};
}

export interface CreatorSettings {
	title: string;
	description: string;
	author: string;
	category: string;
	language: string;
	theme: string;
}

export interface NewCreator extends CreatorSettings {
	username: string;
	password: string;
	email: string;
}

export function parseSocial(value: string | null): Record<string, string> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return parsed as Record<string, string>;
	} catch {
		return {};
	}
}

export function toPublicCreator(
	row: CreatorRow,
	membership: Creator["membership"] = {
		username: row.username,
		role: "owner",
		isOwner: true,
		canPublish: true,
		canEditAll: true,
	},
	email = row.email,
): Creator {
	return {
		username: row.username,
		email,
		title: row.title,
		description: row.description,
		author: row.author,
		category: row.category,
		language: row.language,
		social: parseSocial(row.social),
		theme: row.theme,
		twoFactorEnabled: row.totp_secret !== null,
		createdAt: row.created_at,
		accessedAt: row.accessed_at,
		isAdmin: isAdmin(row),
		suspendedAt: row.suspended_at,
		membership,
	};
}

/** Drivers return the 0/1 column as a number on some dialects and a boolean on others. */
export function isAdmin(row: Pick<CreatorRow, "is_admin">): boolean {
	return Number(row.is_admin) === 1;
}

export function isSuspended(row: Pick<CreatorRow, "suspended_at">): boolean {
	return row.suspended_at !== null;
}

export async function findCreator(username: string): Promise<CreatorRow | null> {
	const rows = (await sql`SELECT * FROM creators WHERE username = ${username}`) as CreatorRow[];
	return rows[0] ?? null;
}

export async function creatorExists(username: string): Promise<boolean> {
	const rows = (await sql`SELECT username FROM creators WHERE username = ${username}`) as { username: string }[];
	return rows.length > 0;
}

export async function insertCreator(creator: NewCreator & { password: string; emailVerified?: boolean }): Promise<void> {
	const timestamp = now();
	await sql`INSERT INTO creators ${sql({
		username: creator.username,
		password: creator.password,
		email: creator.email,
		email_verified_at: creator.emailVerified === false ? null : timestamp,
		totp_secret: null,
		backup_codes: null,
		title: creator.title,
		description: creator.description,
		author: creator.author,
		category: creator.category,
		language: creator.language,
		social: null,
		theme: creator.theme,
		avatar_type: null,
		created_at: timestamp,
		accessed_at: timestamp,
		is_admin: 0,
		suspended_at: null,
	})}`;
}

export async function updateSettings(username: string, settings: CreatorSettings): Promise<void> {
	await sql`UPDATE creators SET ${sql({ ...settings })} WHERE username = ${username}`;
}

export async function updateSocial(username: string, social: Record<string, string>): Promise<void> {
	await sql`UPDATE creators SET social = ${JSON.stringify(social)} WHERE username = ${username}`;
}

export async function updatePassword(username: string, passwordHash: string): Promise<void> {
	await sql`UPDATE creators SET password = ${passwordHash} WHERE username = ${username}`;
}

export async function updateEmail(username: string, email: string): Promise<void> {
	await sql`UPDATE creators SET email = ${email} WHERE username = ${username}`;
}

export function isEmailVerified(row: Pick<CreatorRow, "email_verified_at">): boolean {
	return row.email_verified_at !== null;
}

export async function markEmailVerified(username: string): Promise<void> {
	await sql`UPDATE creators SET email_verified_at = ${now()} WHERE username = ${username}`;
}

export async function updateAvatarType(username: string, contentType: string | null): Promise<void> {
	await sql`UPDATE creators SET avatar_type = ${contentType} WHERE username = ${username}`;
}

export async function updateTwoFactor(username: string, totpSecret: string | null, backupCodes: string | null): Promise<void> {
	await sql`UPDATE creators SET totp_secret = ${totpSecret}, backup_codes = ${backupCodes} WHERE username = ${username}`;
}

export async function touchAccessed(username: string, currentValue: string): Promise<void> {
	const day = today();
	if (currentValue.slice(0, 10) === day) return;
	await sql`UPDATE creators SET accessed_at = ${now()} WHERE username = ${username}`;
}

export async function deleteCreator(username: string): Promise<void> {
	await sql`DELETE FROM creators WHERE username = ${username}`;
}

/**
 * Suspended creators are excluded: this feeds the public landing page, and a
 * suspended blog must not be linked from it.
 */
export async function listCreators(limit = 100, category?: string): Promise<CreatorRow[]> {
	if (category !== undefined) {
		return (await sql`SELECT * FROM creators WHERE suspended_at IS NULL AND category = ${category}
			AND email_verified_at IS NOT NULL
			ORDER BY accessed_at DESC LIMIT ${limit}`) as CreatorRow[];
	}

	return (await sql`SELECT * FROM creators WHERE suspended_at IS NULL AND email_verified_at IS NOT NULL
		ORDER BY accessed_at DESC LIMIT ${limit}`) as CreatorRow[];
}

/** Categories currently represented by at least one public creator. */
export async function listCreatorCategories(): Promise<string[]> {
	const rows = (await sql`SELECT DISTINCT category FROM creators
		WHERE suspended_at IS NULL AND email_verified_at IS NOT NULL ORDER BY category ASC`) as { category: string }[];
	return rows.map((row) => row.category);
}

export async function countCreators(): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM creators`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}

/** Every account, suspended ones included. For maintenance that must not skip any. */
export async function listAllCreators(): Promise<{ username: string }[]> {
	return (await sql`SELECT username FROM creators ORDER BY username ASC`) as { username: string }[];
}

export async function setAdmin(username: string, admin: boolean): Promise<void> {
	await sql`UPDATE creators SET is_admin = ${admin ? 1 : 0} WHERE username = ${username}`;
}

export async function setSuspended(username: string, suspended: boolean): Promise<void> {
	await sql`UPDATE creators SET suspended_at = ${suspended ? now() : null} WHERE username = ${username}`;
}

export async function countAdmins(): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM creators WHERE is_admin = 1`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}

/** One row of the moderation table. */
export interface CreatorOverview {
	username: string;
	author: string;
	title: string;
	email: string;
	createdAt: string;
	accessedAt: string;
	isAdmin: boolean;
	suspendedAt: string | null;
	posts: number;
	drafts: number;
	storage: number;
}

export type OverviewSort = "username" | "posts" | "storage" | "created" | "accessed";

const SORT_COLUMNS: Record<OverviewSort, string> = {
	username: "c.username",
	posts: "posts",
	storage: "storage",
	created: "c.created_at",
	accessed: "c.accessed_at",
};

/**
 * The moderation table: every account with its post count and stored bytes.
 *
 * Counted in correlated subqueries rather than joins, because joining both
 * `posts` and `media` at once multiplies their rows together and inflates every
 * total. Sorting and paging happen in SQL so the table still works once an
 * instance has more accounts than fit on a screen.
 *
 * The sort column is looked up in {@link SORT_COLUMNS} rather than
 * interpolated, since an identifier cannot be a bind parameter.
 */
export async function listCreatorOverview(sort: OverviewSort = "storage", descending = true, limit = 100, offset = 0): Promise<CreatorOverview[]> {
	const column = SORT_COLUMNS[sort] ?? SORT_COLUMNS.storage;
	const direction = descending ? "DESC" : "ASC";

	const rows = (await sql`SELECT c.username, c.author, c.title, c.email, c.created_at, c.accessed_at, c.is_admin, c.suspended_at,
			(SELECT COUNT(*) FROM posts p WHERE p.username = c.username AND p.status = 'published') AS posts,
			(SELECT COUNT(*) FROM posts p WHERE p.username = c.username AND p.status <> 'published') AS drafts,
			(SELECT COALESCE(SUM(m.size), 0) FROM media m WHERE m.username = c.username) AS storage
		FROM creators c
		ORDER BY ${sql.unsafe(`${column} ${direction}`)}, c.username ASC
		LIMIT ${limit} OFFSET ${offset}`) as Record<string, unknown>[];

	return rows.map((row) => ({
		username: String(row.username),
		author: String(row.author),
		title: String(row.title),
		email: String(row.email),
		createdAt: String(row.created_at),
		accessedAt: String(row.accessed_at),
		isAdmin: Number(row.is_admin) === 1,
		suspendedAt: row.suspended_at === null ? null : String(row.suspended_at),
		posts: Number(row.posts ?? 0),
		drafts: Number(row.drafts ?? 0),
		storage: Number(row.storage ?? 0),
	}));
}
