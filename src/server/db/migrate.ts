import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";
import { connect, disconnect, now, sql } from "./index.ts";
import { migrations, migrationsTable } from "./schema.ts";

export async function migrate(): Promise<void> {
	await sql.unsafe(migrationsTable(config.database.dialect));

	const applied = new Set<string>();
	const rows = await sql`SELECT name FROM migrations`;
	for (const row of rows as { name: string }[]) applied.add(row.name);

	const pending = migrations(config.database.dialect).filter((m) => !applied.has(m.name));

	if (pending.length === 0) {
		logger.info("Database schema is up to date");
		return;
	}

	for (const migration of pending) {
		logger.info(`Applying migration ${migration.name}`);
		for (const statement of migration.statements) {
			await sql.unsafe(statement);
		}
		await sql`INSERT INTO migrations ${sql({ name: migration.name, applied_at: now() })}`;
	}

	logger.info(`Applied ${pending.length} migration(s)`);
}

if (import.meta.main) {
	await connect();
	await migrate();
	await disconnect();
}
