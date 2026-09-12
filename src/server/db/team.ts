import { TEAM_ROLES, type TeamRole } from "../../shared/constants.ts";
import { generateToken, hash } from "../lib/crypto.ts";
import { isSqlite, now, sql } from "./index.ts";

export { TEAM_ROLES, type TeamRole };

export interface TeamMemberRow {
	username: string;
	blog_username: string;
	password: string;
	email: string;
	role: TeamRole;
	created_at: string;
	accessed_at: string;
}

export interface TeamMember {
	username: string;
	email: string;
	role: TeamRole;
	createdAt: string;
	accessedAt: string;
}

export interface TeamInviteRow {
	token_hash: string;
	blog_username: string;
	email: string;
	role: TeamRole;
	created_at: string;
	expires_at: string;
}

export interface TeamInvite {
	id: string;
	email: string;
	role: TeamRole;
	createdAt: string;
	expiresAt: string;
}

export function isTeamRole(value: unknown): value is TeamRole {
	return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

export function toTeamMember(row: TeamMemberRow): TeamMember {
	return {
		username: row.username,
		email: row.email,
		role: row.role,
		createdAt: row.created_at,
		accessedAt: row.accessed_at,
	};
}

function changedRows(result: unknown): number {
	const mutation = result as { affectedRows?: number | null; count?: number | null };
	return Number(mutation.affectedRows ?? mutation.count ?? 0);
}

function toTeamInvite(row: TeamInviteRow): TeamInvite {
	return {
		id: row.token_hash,
		email: row.email,
		role: row.role,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
	};
}

export async function findTeamMember(username: string): Promise<TeamMemberRow | null> {
	const rows = (await sql`SELECT * FROM team_members WHERE username = ${username}`) as TeamMemberRow[];
	return rows[0] ?? null;
}

export async function teamMemberExists(username: string): Promise<boolean> {
	return (await findTeamMember(username)) !== null;
}

export async function listTeamMembers(blogUsername: string): Promise<TeamMember[]> {
	const rows = (await sql`SELECT * FROM team_members WHERE blog_username = ${blogUsername} ORDER BY created_at ASC`) as TeamMemberRow[];
	return rows.map(toTeamMember);
}

export async function insertTeamMember(member: { username: string; blogUsername: string; password: string; email: string; role: TeamRole }): Promise<void> {
	const timestamp = now();
	await sql`INSERT INTO team_members ${sql({
		username: member.username,
		blog_username: member.blogUsername,
		password: member.password,
		email: member.email,
		role: member.role,
		created_at: timestamp,
		accessed_at: timestamp,
	})}`;
}

export async function updateTeamMemberRole(blogUsername: string, username: string, role: TeamRole): Promise<number> {
	const result = await sql`UPDATE team_members SET role = ${role} WHERE blog_username = ${blogUsername} AND username = ${username}`;
	return changedRows(result);
}

export async function updateTeamMemberPassword(username: string, password: string): Promise<void> {
	await sql`UPDATE team_members SET password = ${password} WHERE username = ${username}`;
}

export async function touchTeamMember(username: string, accessedAt: string): Promise<void> {
	if (accessedAt.slice(0, 10) === now().slice(0, 10)) return;
	await sql`UPDATE team_members SET accessed_at = ${now()} WHERE username = ${username}`;
}

export async function deleteTeamMember(blogUsername: string, username: string): Promise<number> {
	const result = await sql`DELETE FROM team_members WHERE blog_username = ${blogUsername} AND username = ${username}`;
	return changedRows(result);
}

export async function listTeamMemberUsernames(blogUsername: string): Promise<string[]> {
	const rows = (await sql`SELECT username FROM team_members WHERE blog_username = ${blogUsername}`) as { username: string }[];
	return rows.map((row) => row.username);
}

export async function deleteTeamMembers(blogUsername: string): Promise<void> {
	await sql`DELETE FROM team_members WHERE blog_username = ${blogUsername}`;
}

export async function createTeamInvite(blogUsername: string, email: string, role: TeamRole, ttlDays = 7): Promise<{ token: string; invite: TeamInvite }> {
	const token = generateToken(64);
	const timestamp = now();
	const row: TeamInviteRow = {
		token_hash: hash(token),
		blog_username: blogUsername,
		email,
		role,
		created_at: timestamp,
		expires_at: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
	};
	await sql`INSERT INTO team_invites ${sql(row)}`;
	return { token, invite: toTeamInvite(row) };
}

export async function findTeamInvite(token: string): Promise<TeamInviteRow | null> {
	const rows = (await sql`SELECT * FROM team_invites WHERE token_hash = ${hash(token)} AND expires_at > ${now()}`) as TeamInviteRow[];
	return rows[0] ?? null;
}

export async function listTeamInvites(blogUsername: string): Promise<TeamInvite[]> {
	const rows = (await sql`SELECT * FROM team_invites WHERE blog_username = ${blogUsername} AND expires_at > ${now()}
		ORDER BY created_at DESC`) as TeamInviteRow[];
	return rows.map(toTeamInvite);
}

export async function deleteTeamInvite(blogUsername: string, id: string): Promise<number> {
	const result = await sql`DELETE FROM team_invites WHERE blog_username = ${blogUsername} AND token_hash = ${id}`;
	return changedRows(result);
}

export async function consumeTeamInvite(token: string): Promise<void> {
	await sql`DELETE FROM team_invites WHERE token_hash = ${hash(token)}`;
}

/** Consumes and creates the member on one connection, so a link works once even under concurrent requests. */
export async function acceptTeamInvite(token: string, username: string, password: string): Promise<TeamInviteRow | null> {
	return await sql.begin(async (transaction) => {
		const tokenHash = hash(token);
		const rows = (
			isSqlite
				? await transaction`SELECT * FROM team_invites WHERE token_hash = ${tokenHash} AND expires_at > ${now()}`
				: await transaction`SELECT * FROM team_invites WHERE token_hash = ${tokenHash} AND expires_at > ${now()} FOR UPDATE`
		) as TeamInviteRow[];
		const invite = rows[0];
		if (invite === undefined) return null;

		await transaction`DELETE FROM team_invites WHERE token_hash = ${tokenHash}`;
		const timestamp = now();
		await transaction`INSERT INTO team_members ${transaction({
			username,
			blog_username: invite.blog_username,
			password,
			email: invite.email,
			role: invite.role,
			created_at: timestamp,
			accessed_at: timestamp,
		})}`;
		return invite;
	});
}

export async function deleteTeamInvites(blogUsername: string): Promise<void> {
	await sql`DELETE FROM team_invites WHERE blog_username = ${blogUsername}`;
}

export async function pruneExpiredTeamInvites(): Promise<void> {
	await sql`DELETE FROM team_invites WHERE expires_at <= ${now()}`;
}
