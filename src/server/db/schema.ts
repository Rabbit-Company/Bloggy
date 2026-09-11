import type { DatabaseDialect } from "../config.ts";

/**
 * Three portability rules keep one schema working across SQLite, PostgreSQL,
 * MySQL and MariaDB:
 *
 *  1. Timestamps are ISO-8601 strings in VARCHAR(32), not native date types.
 *     Each driver coerces dates differently, while text round-trips identically and
 *     still sorts correctly.
 *  2. Every indexed or key column is VARCHAR(n) rather than TEXT, because
 *     MySQL cannot index an unbounded TEXT column without a prefix length.
 *  3. Indexes are declared inline for MySQL/MariaDB (which reject
 *     `CREATE INDEX IF NOT EXISTS`) and as separate statements elsewhere.
 */

function text(d: DatabaseDialect): string {
	return d === "mysql" || d === "mariadb" ? "MEDIUMTEXT" : "TEXT";
}

function varchar(d: DatabaseDialect, n: number): string {
	return d === "sqlite" ? "TEXT" : `VARCHAR(${n})`;
}

function integer(d: DatabaseDialect): string {
	return d === "postgres" ? "INTEGER" : "INTEGER";
}

function timestamp(d: DatabaseDialect): string {
	return varchar(d, 32);
}

export interface Migration {
	name: string;
	statements: string[];
}

/**
 * Migrations are append-only: never edit a shipped entry, add a new one. The
 * runner records each applied name and skips it on subsequent boots.
 */
export function migrations(d: DatabaseDialect): Migration[] {
	const inlineIndexes = d === "mysql" || d === "mariadb";

	const index = (table: string, name: string, columns: string): { inline?: string; statement?: string } =>
		inlineIndexes ? { inline: `INDEX ${name} (${columns})` } : { statement: `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})` };

	const creatorIdx = [index("creators", "idx_creators_accessed", "accessed_at"), index("creators", "idx_creators_category", "category")];

	const postIdx = [
		index("posts", "idx_posts_username_created", "username, created_at"),
		index("posts", "idx_posts_created", "created_at"),
		index("posts", "idx_posts_category", "category"),
	];

	const sessionIdx = [index("sessions", "idx_sessions_username", "username"), index("sessions", "idx_sessions_expires", "expires_at")];

	const mediaIdx = [index("media", "idx_media_username_kind", "username, kind"), index("media", "idx_media_created", "created_at")];

	const viewIdx = [index("post_views", "idx_post_views_day", "day")];

	const body = (columns: string[], indexes: { inline?: string }[]): string =>
		[...columns, ...indexes.map((i) => i.inline).filter((i): i is string => typeof i === "string")].join(",\n\t");

	const trailing = (indexes: { statement?: string }[]): string[] => indexes.map((i) => i.statement).filter((s): s is string => typeof s === "string");

	return [
		{
			name: "0001_initial",
			statements: [
				`CREATE TABLE IF NOT EXISTS creators (
	${body(
		[
			`username ${varchar(d, 30)} NOT NULL PRIMARY KEY`,
			`password ${text(d)} NOT NULL`,
			`email ${varchar(d, 320)} NOT NULL`,
			`totp_secret ${text(d)}`,
			`backup_codes ${text(d)}`,
			`title ${varchar(d, 30)} NOT NULL`,
			`description ${varchar(d, 160)} NOT NULL`,
			`author ${varchar(d, 30)} NOT NULL`,
			`category ${varchar(d, 50)} NOT NULL`,
			`language ${varchar(d, 10)} NOT NULL`,
			`social ${text(d)}`,
			`theme ${varchar(d, 30)} NOT NULL`,
			`avatar_type ${varchar(d, 50)}`,
			`created_at ${timestamp(d)} NOT NULL`,
			`accessed_at ${timestamp(d)} NOT NULL`,
		],
		creatorIdx,
	)}
)`,
				...trailing(creatorIdx),

				`CREATE TABLE IF NOT EXISTS posts (
	${body(
		[
			`username ${varchar(d, 30)} NOT NULL`,
			`slug ${varchar(d, 100)} NOT NULL`,
			`title ${varchar(d, 100)} NOT NULL`,
			`description ${varchar(d, 300)} NOT NULL`,
			`picture ${varchar(d, 500)} NOT NULL`,
			`markdown ${text(d)} NOT NULL`,
			`category ${varchar(d, 50)} NOT NULL`,
			`language ${varchar(d, 10)} NOT NULL`,
			`tag ${varchar(d, 30)} NOT NULL`,
			`keywords ${varchar(d, 255)} NOT NULL`,
			`word_count ${integer(d)} NOT NULL`,
			`read_time ${integer(d)} NOT NULL`,
			`created_at ${timestamp(d)} NOT NULL`,
			`updated_at ${timestamp(d)} NOT NULL`,
			`PRIMARY KEY (username, slug)`,
		],
		postIdx,
	)}
)`,
				...trailing(postIdx),

				`CREATE TABLE IF NOT EXISTS sessions (
	${body(
		[
			`id ${varchar(d, 128)} NOT NULL PRIMARY KEY`,
			`username ${varchar(d, 30)} NOT NULL`,
			`ip ${varchar(d, 128)}`,
			`user_agent ${varchar(d, 255)}`,
			`created_at ${timestamp(d)} NOT NULL`,
			`last_used_at ${timestamp(d)} NOT NULL`,
			`expires_at ${timestamp(d)} NOT NULL`,
		],
		sessionIdx,
	)}
)`,
				...trailing(sessionIdx),

				`CREATE TABLE IF NOT EXISTS media (
	${body(
		[
			`id ${varchar(d, 36)} NOT NULL PRIMARY KEY`,
			`username ${varchar(d, 30)} NOT NULL`,
			`kind ${varchar(d, 10)} NOT NULL`,
			`content_type ${varchar(d, 100)} NOT NULL`,
			`size ${integer(d)} NOT NULL`,
			`created_at ${timestamp(d)} NOT NULL`,
		],
		mediaIdx,
	)}
)`,
				...trailing(mediaIdx),

				`CREATE TABLE IF NOT EXISTS post_views (
	${body(
		[
			`username ${varchar(d, 30)} NOT NULL`,
			`slug ${varchar(d, 100)} NOT NULL`,
			`day ${varchar(d, 10)} NOT NULL`,
			`views ${integer(d)} NOT NULL`,
			`PRIMARY KEY (username, slug, day)`,
		],
		viewIdx,
	)}
)`,
				...trailing(viewIdx),
			],
		},

		{
			name: "0002_drafts",
			statements: [
				`ALTER TABLE posts ADD COLUMN status ${varchar(d, 10)} NOT NULL DEFAULT 'published'`,

				`ALTER TABLE posts ADD COLUMN published_at ${timestamp(d)}`,

				`UPDATE posts SET published_at = created_at WHERE published_at IS NULL`,

				`CREATE INDEX idx_posts_status_published ON posts (username, status, published_at)`,
			],
		},

		{
			name: "0003_drop_post_views",
			statements: [`DROP TABLE IF EXISTS post_views`],
		},

		{
			name: "0004_moderation",
			statements: [
				`ALTER TABLE creators ADD COLUMN is_admin ${integer(d)} NOT NULL DEFAULT 0`,

				`ALTER TABLE creators ADD COLUMN suspended_at ${timestamp(d)}`,

				`CREATE INDEX idx_media_username ON media (username)`,
			],
		},
	];
}

export function migrationsTable(d: DatabaseDialect): string {
	return `CREATE TABLE IF NOT EXISTS migrations (
	name ${varchar(d, 255)} NOT NULL PRIMARY KEY,
	applied_at ${timestamp(d)} NOT NULL
)`;
}
