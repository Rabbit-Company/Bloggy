import { generateToken, hash } from "../lib/crypto.ts";
import { isSqlite, now, sql } from "./index.ts";

export interface EmailConfirmationRow {
	token_hash: string;
	username: string;
	email: string;
	created_at: string;
	expires_at: string;
}

function changedRows(result: unknown): number {
	const mutation = result as { affectedRows?: number | null; count?: number | null };
	return Number(mutation.affectedRows ?? mutation.count ?? 0);
}

/** Returns null during the cooldown so resend requests cannot flood an inbox. */
export async function createEmailConfirmationToken(username: string, email: string, ttlSeconds: number, cooldownSeconds = 300): Promise<string | null> {
	const timestamp = now();
	const cutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
	const recent = (await sql`SELECT token_hash FROM email_confirmation_tokens
		WHERE username = ${username} AND email = ${email} AND created_at > ${cutoff} AND expires_at > ${timestamp}
		LIMIT 1`) as { token_hash: string }[];
	if (recent.length > 0) return null;

	const token = generateToken(64);
	await sql.begin(async (transaction) => {
		await transaction`DELETE FROM email_confirmation_tokens WHERE username = ${username}`;
		await transaction`INSERT INTO email_confirmation_tokens ${transaction({
			token_hash: hash(token),
			username,
			email,
			created_at: timestamp,
			expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
		})}`;
	});
	return token;
}

export async function emailConfirmationTokenExists(token: string): Promise<boolean> {
	const rows = (await sql`SELECT token_hash FROM email_confirmation_tokens
		WHERE token_hash = ${hash(token)} AND expires_at > ${now()}`) as { token_hash: string }[];
	return rows.length > 0;
}

/** Confirms the current address and consumes every outstanding link atomically. */
export async function consumeEmailConfirmationToken(token: string): Promise<string | null> {
	return await sql.begin(async (transaction) => {
		const tokenHash = hash(token);
		const rows = (
			isSqlite
				? await transaction`SELECT * FROM email_confirmation_tokens WHERE token_hash = ${tokenHash} AND expires_at > ${now()}`
				: await transaction`SELECT * FROM email_confirmation_tokens WHERE token_hash = ${tokenHash} AND expires_at > ${now()} FOR UPDATE`
		) as EmailConfirmationRow[];
		const confirmation = rows[0];
		if (confirmation === undefined) return null;

		const result = await transaction`UPDATE creators SET email_verified_at = ${now()}
			WHERE username = ${confirmation.username} AND email = ${confirmation.email} AND email_verified_at IS NULL`;
		if (changedRows(result) === 0) return null;

		await transaction`DELETE FROM email_confirmation_tokens WHERE username = ${confirmation.username}`;
		return confirmation.username;
	});
}

export async function deleteEmailConfirmationTokens(username: string): Promise<void> {
	await sql`DELETE FROM email_confirmation_tokens WHERE username = ${username}`;
}

export async function pruneExpiredEmailConfirmationTokens(): Promise<void> {
	await sql`DELETE FROM email_confirmation_tokens WHERE expires_at <= ${now()}`;
}
