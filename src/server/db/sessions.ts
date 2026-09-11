import { now, sql } from "./index.ts";

export interface SessionRow {
	id: string;
	username: string;
	ip: string | null;
	user_agent: string | null;
	created_at: string;
	last_used_at: string;
	expires_at: string;
}

export interface SessionSummary {
	id: string;
	ip: string | null;
	userAgent: string | null;
	createdAt: string;
	lastUsedAt: string;
	expiresAt: string;
	current: boolean;
}

export async function insertSession(session: SessionRow): Promise<void> {
	await sql`INSERT INTO sessions ${sql({ ...session })}`;
}

/**
 * The expiry is filtered in SQL so a stale row can never authenticate even if
 * the cleanup job has not run yet.
 */
export async function findSession(id: string): Promise<SessionRow | null> {
	const rows = (await sql`SELECT * FROM sessions WHERE id = ${id} AND expires_at > ${now()}`) as SessionRow[];
	return rows[0] ?? null;
}

export async function listSessions(username: string): Promise<SessionRow[]> {
	return (await sql`SELECT * FROM sessions WHERE username = ${username} AND expires_at > ${now()}
		ORDER BY last_used_at DESC`) as SessionRow[];
}

/**
 * Skipped when the stored value is already within `minIntervalMs`, so a burst
 * of requests does not turn every read into a write.
 */
export async function touchSession(id: string, lastUsedAt: string, minIntervalMs = 300_000): Promise<void> {
	if (Date.now() - Date.parse(lastUsedAt) < minIntervalMs) return;
	await sql`UPDATE sessions SET last_used_at = ${now()} WHERE id = ${id}`;
}

export async function deleteSession(id: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE id = ${id}`;
}

export async function deleteSessionFor(username: string, id: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE id = ${id} AND username = ${username}`;
}

/**
 * The panel never sees a full token hash, so revocation matches on the prefix.
 * The prefix is validated as hex before it reaches the LIKE pattern, which
 * rules out wildcard characters, and scoping to `username` bounds it further.
 */
export async function deleteSessionByPrefix(username: string, prefix: string): Promise<number> {
	if (!/^[0-9a-f]{16,128}$/.test(prefix)) return 0;
	const result = await sql`DELETE FROM sessions WHERE username = ${username} AND id LIKE ${`${prefix}%`}`;
	return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function deleteSessionsByCreator(username: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE username = ${username}`;
}

export async function deleteOtherSessions(username: string, keepId: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE username = ${username} AND id <> ${keepId}`;
}

export async function pruneExpiredSessions(): Promise<void> {
	await sql`DELETE FROM sessions WHERE expires_at <= ${now()}`;
}

export async function countSessions(): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM sessions WHERE expires_at > ${now()}`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}
