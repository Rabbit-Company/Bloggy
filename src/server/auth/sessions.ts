import { config } from "../config.ts";
import { generateToken, hash } from "../lib/crypto.ts";
import { now } from "../db/index.ts";
import { deleteSession, findSession, insertSession, listSessions, touchSession, type SessionRow, type SessionSummary } from "../db/sessions.ts";

export interface IssuedSession {
	token: string;
	expiresAt: string;
}

/**
 * Only the blake2b digest of the token is persisted, so the plaintext exists
 * solely in this return value and in the client that receives it.
 */
export async function createSession(username: string, ip?: string, userAgent?: string): Promise<IssuedSession> {
	const token = generateToken(64);
	const timestamp = now();
	const expiresAt = new Date(Date.now() + config.limits.sessionTtl * 1000).toISOString();

	await insertSession({
		id: hash(token),
		username,
		ip: ip ?? null,
		user_agent: userAgent?.slice(0, 255) ?? null,
		created_at: timestamp,
		last_used_at: timestamp,
		expires_at: expiresAt,
	});

	return { token, expiresAt };
}

export async function resolveSession(token: string): Promise<SessionRow | null> {
	const session = await findSession(hash(token));
	if (!session) return null;

	await touchSession(session.id, session.last_used_at);
	return session;
}

export async function revokeSession(token: string): Promise<void> {
	await deleteSession(hash(token));
}

export async function summarizeSessions(username: string, currentToken: string): Promise<SessionSummary[]> {
	const currentId = hash(currentToken);
	const sessions = await listSessions(username);

	return sessions.map((session) => ({
		id: session.id.slice(0, 32),
		ip: session.ip,
		userAgent: session.user_agent,
		createdAt: session.created_at,
		lastUsedAt: session.last_used_at,
		expiresAt: session.expires_at,
		current: session.id === currentId,
	}));
}
