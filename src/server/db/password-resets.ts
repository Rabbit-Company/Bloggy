import { generateToken, hash } from "../lib/crypto.ts";
import { isSqlite, now, sql } from "./index.ts";

export interface PasswordResetRow {
	token_hash: string;
	username: string;
	created_at: string;
	expires_at: string;
}

function changedRows(result: unknown): number {
	const mutation = result as { affectedRows?: number | null; count?: number | null };
	return Number(mutation.affectedRows ?? mutation.count ?? 0);
}

/**
 * Issues at most one email-worthy token per account during the cooldown. The
 * caller deliberately treats `null` exactly like success to avoid revealing
 * whether the username exists or was recently requested.
 */
export async function createPasswordResetToken(username: string, ttlSeconds: number, cooldownSeconds = 300): Promise<string | null> {
	const timestamp = now();
	const cutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
	const recent = (await sql`SELECT token_hash FROM password_reset_tokens
		WHERE username = ${username} AND created_at > ${cutoff} AND expires_at > ${timestamp}
		LIMIT 1`) as { token_hash: string }[];
	if (recent.length > 0) return null;

	const token = generateToken(64);
	await sql.begin(async (transaction) => {
		await transaction`DELETE FROM password_reset_tokens WHERE username = ${username}`;
		await transaction`INSERT INTO password_reset_tokens ${transaction({
			token_hash: hash(token),
			username,
			created_at: timestamp,
			expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
		})}`;
	});
	return token;
}

export async function passwordResetTokenExists(token: string): Promise<boolean> {
	const rows = (await sql`SELECT token_hash FROM password_reset_tokens
		WHERE token_hash = ${hash(token)} AND expires_at > ${now()}`) as { token_hash: string }[];
	return rows.length > 0;
}

/** Updates either an owner or collaborator and consumes the token atomically. */
export async function consumePasswordResetToken(token: string, password: string): Promise<boolean> {
	return await sql.begin(async (transaction) => {
		const tokenHash = hash(token);
		const rows = (
			isSqlite
				? await transaction`SELECT * FROM password_reset_tokens WHERE token_hash = ${tokenHash} AND expires_at > ${now()}`
				: await transaction`SELECT * FROM password_reset_tokens WHERE token_hash = ${tokenHash} AND expires_at > ${now()} FOR UPDATE`
		) as PasswordResetRow[];
		const reset = rows[0];
		if (reset === undefined) return false;

		await transaction`DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash}`;
		const ownerResult = await transaction`UPDATE creators SET password = ${password} WHERE username = ${reset.username}`;
		if (changedRows(ownerResult) === 0) {
			const memberResult = await transaction`UPDATE team_members SET password = ${password} WHERE username = ${reset.username}`;
			if (changedRows(memberResult) === 0) return false;
		}

		await transaction`DELETE FROM sessions WHERE username = ${reset.username}`;
		return true;
	});
}

export async function deletePasswordResetTokens(username: string): Promise<void> {
	await sql`DELETE FROM password_reset_tokens WHERE username = ${username}`;
}

export async function pruneExpiredPasswordResetTokens(): Promise<void> {
	await sql`DELETE FROM password_reset_tokens WHERE expires_at <= ${now()}`;
}
