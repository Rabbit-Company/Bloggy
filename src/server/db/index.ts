import { SQL } from "bun";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config, type DatabaseDialect } from "../config.ts";
import { logger } from "../lib/logger.ts";

export const dialect: DatabaseDialect = config.database.dialect;

export const isSqlite = dialect === "sqlite";

export const isMysqlFamily = dialect === "mysql" || dialect === "mariadb";

function sqliteFilename(url: string): string {
	return url.replace(/^(sqlite|file):\/\//, "");
}

if (isSqlite) {
	const filename = sqliteFilename(config.database.url);
	if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
}

/**
 * The same tagged-template API covers SQLite, PostgreSQL, MySQL and MariaDB;
 * only the schema DDL differs per dialect (see ./schema.ts). Bun connects
 * lazily on the first query, so this is safe to construct at module load,
 * which keeps it a plain `const` that is safe to destructure on import.
 */
export const sql: SQL = isSqlite ? new SQL(config.database.url) : new SQL(config.database.url, { max: config.database.poolSize });

export async function connect(): Promise<SQL> {
	if (isSqlite) {
		// WAL lets readers proceed while a write is in flight, which matters
		// because rendered pages read on every cache miss.
		await sql`PRAGMA journal_mode = WAL`;
		await sql`PRAGMA foreign_keys = ON`;
		await sql`PRAGMA busy_timeout = 5000`;
	} else {
		await sql.connect();
	}

	logger.info(`Connected to ${dialect} database`);
	return sql;
}

export async function disconnect(): Promise<void> {
	await sql.close({ timeout: 5 });
	logger.info("Database connection closed");
}

export function now(): string {
	return new Date().toISOString();
}

export function today(): string {
	return new Date().toISOString().slice(0, 10);
}
