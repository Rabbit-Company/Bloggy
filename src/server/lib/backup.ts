import { S3Client } from "bun";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { isSqlite, sql } from "../db/index.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import { logger } from "./logger.ts";

export interface BackupEntry {
	key: string;
	/** Just the file name, which is what the UI shows and the API addresses. */
	name: string;
	size: number;
	createdAt: string;
}

export interface BackupStatus {
	/** False when the dialect or the configuration rules backups out. */
	available: boolean;
	reason: string | null;
	enabled: boolean;
	intervalSeconds: number;
	keep: number;
}

const NAME = /^bloggy-[0-9]{8}T[0-9]{6}Z\.sqlite$/;

let client: S3Client | null = null;

function bucket(): S3Client {
	if (client !== null) return client;

	const { bucket: name, endpoint, region, accessKeyId, secretAccessKey } = config.backup.s3;
	client = new S3Client({ bucket: name, accessKeyId, secretAccessKey, region, ...(endpoint.length > 0 ? { endpoint } : {}) });
	return client;
}

/**
 * Why backups cannot run, or null when they can.
 *
 * A snapshot is taken with `VACUUM INTO`, which is a SQLite feature. The other
 * dialects have their own backup tooling and dumping them is not a file copy.
 */
function unavailableReason(): string | null {
	if (!isSqlite) return `Backups are for SQLite. This instance runs ${config.database.dialect}, which has its own backup tooling.`;
	if (config.database.url.includes(":memory:")) return "This instance runs an in-memory database, which has nothing to back up.";

	const { bucket: name, accessKeyId, secretAccessKey } = config.backup.s3;
	if (name.length === 0 || accessKeyId.length === 0 || secretAccessKey.length === 0) {
		return "Set BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY to enable backups.";
	}
	return null;
}

export function backupStatus(): BackupStatus {
	const reason = unavailableReason();
	return {
		available: reason === null,
		reason,
		enabled: config.backup.enabled && reason === null,
		intervalSeconds: Math.max(300, config.backup.intervalSeconds),
		keep: Math.max(1, config.backup.keep),
	};
}

function requireAvailable(): void {
	const reason = unavailableReason();
	if (reason !== null) throw new ApiError(ErrorCode.BACKUP_UNAVAILABLE, reason);
}

/** The database file behind the configured SQLite URL. */
function databasePath(): string {
	return config.database.url.replace(/^(sqlite|file):\/\//, "");
}

function keyFor(name: string): string {
	const prefix = config.backup.prefix.replace(/^\/+|\/+$/g, "");
	return prefix.length === 0 ? name : `${prefix}/${name}`;
}

/**
 * Rejects any name that did not come from {@link createBackup}.
 *
 * Names reach here from the panel and address an object in the bucket, so
 * without this a crafted value could walk out of the prefix.
 */
function assertName(name: string): void {
	if (!NAME.test(name)) throw new ApiError(ErrorCode.NOT_FOUND, "No such backup.");
}

/**
 * Takes a consistent snapshot and uploads it.
 *
 * `VACUUM INTO` rather than copying the file: the database runs in WAL mode, so
 * a plain copy misses every commit still sitting in the `-wal` file and quietly
 * restores an older database than the one you asked for.
 */
export async function createBackup(): Promise<BackupEntry> {
	requireAvailable();

	const name = `bloggy-${new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z$/, "Z")}.sqlite`;
	const staging = join(dirname(databasePath()), `.${name}.tmp`);

	await rm(staging, { force: true });
	// A SQL string literal, not a JSON one: SQLite escapes a quote by doubling
	// it, where JSON.stringify would emit a backslash SQLite does not read.
	await sql.unsafe(`VACUUM INTO '${staging.replace(/'/g, "''")}'`);

	try {
		const file = Bun.file(staging);
		const size = file.size;
		await bucket().file(keyFor(name)).write(file, { type: "application/vnd.sqlite3" });

		logger.audit(`Backup created: ${name}`, { name, size });
		await prune();

		return { key: keyFor(name), name, size, createdAt: new Date().toISOString() };
	} finally {
		await rm(staging, { force: true });
	}
}

export async function listBackups(): Promise<BackupEntry[]> {
	requireAvailable();

	const entries: BackupEntry[] = [];
	let continuationToken: string | undefined;

	do {
		const page = await bucket().list({ prefix: keyFor(""), ...(continuationToken === undefined ? {} : { continuationToken }) });

		for (const object of page.contents ?? []) {
			if (object.key === undefined) continue;
			const name = object.key.slice(object.key.lastIndexOf("/") + 1);
			if (!NAME.test(name)) continue;

			entries.push({
				key: object.key,
				name,
				size: object.size ?? 0,
				createdAt: object.lastModified ?? new Date().toISOString(),
			});
		}

		continuationToken = page.isTruncated === true ? page.nextContinuationToken : undefined;
	} while (continuationToken !== undefined);

	return entries.sort((a, b) => b.name.localeCompare(a.name));
}

/** Deletes the oldest snapshots beyond the configured limit. */
async function prune(): Promise<void> {
	const keep = Math.max(1, config.backup.keep);
	const entries = await listBackups();
	if (entries.length <= keep) return;

	for (const entry of entries.slice(keep)) {
		await bucket().file(entry.key).delete();
		logger.audit(`Backup pruned: ${entry.name}`, { name: entry.name });
	}
}

export async function deleteBackup(name: string): Promise<void> {
	requireAvailable();
	assertName(name);

	const file = bucket().file(keyFor(name));
	if (!(await file.exists())) throw new ApiError(ErrorCode.NOT_FOUND, "No such backup.");

	await file.delete();
	logger.audit(`Backup deleted: ${name}`, { name });
}

export async function readBackup(name: string): Promise<{ stream: ReadableStream; size: number }> {
	requireAvailable();
	assertName(name);

	const file = bucket().file(keyFor(name));
	if (!(await file.exists())) throw new ApiError(ErrorCode.NOT_FOUND, "No such backup.");

	return { stream: file.stream(), size: (await file.stat()).size };
}

/**
 * Puts a snapshot in place of the live database, then stops the process.
 *
 * The database is open, so it cannot be swapped underneath itself. The snapshot
 * is downloaded, checked, and only then does the live file get replaced and the
 * process exit for a supervisor to restart into the restored database. The
 * previous database is kept alongside, because a restore is the one operation
 * where being wrong is unrecoverable.
 *
 * The `-wal` and `-shm` files are removed with it: they belong to the database
 * being replaced, and leaving them would have SQLite recover a journal that
 * does not match the new file.
 */
export async function restoreBackup(name: string): Promise<{ restored: string; previous: string }> {
	requireAvailable();
	assertName(name);

	const file = bucket().file(keyFor(name));
	if (!(await file.exists())) throw new ApiError(ErrorCode.NOT_FOUND, "No such backup.");

	const live = databasePath();
	const staging = `${live}.restoring`;
	await Bun.write(staging, file);

	try {
		await assertUsableDatabase(staging);
	} catch (err) {
		// A snapshot that will not open must not leave a half-downloaded file
		// sitting next to the database it failed to replace.
		await rm(staging, { force: true });
		throw err;
	}

	const previous = `${live}.replaced-${Date.now()}`;
	await Bun.write(previous, Bun.file(live));

	logger.audit(`Restoring backup: ${name}`, { name, previous });

	// Nothing may touch the database between here and the exit.
	await sql.close({ timeout: 5 }).catch(() => undefined);

	await rm(`${live}-wal`, { force: true });
	await rm(`${live}-shm`, { force: true });
	await Bun.write(live, Bun.file(staging));
	await rm(staging, { force: true });

	logger.audit(`Backup restored, exiting for restart: ${name}`, { name });

	// Give the response a moment to flush before the process goes away.
	setTimeout(() => process.exit(0), 250).unref?.();

	return { restored: name, previous };
}

/** Opens a downloaded snapshot and checks it looks like this application's database. */
async function assertUsableDatabase(path: string): Promise<void> {
	const { SQL } = await import("bun");
	const probe = new SQL(`sqlite://${path}`);
	try {
		const rows = (await probe`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('creators', 'posts', 'migrations')`) as { name: string }[];
		if (rows.length < 3) throw new ApiError(ErrorCode.BACKUP_INVALID, "That file is not a Bloggy database.");
	} catch (err) {
		if (err instanceof ApiError) throw err;
		throw new ApiError(ErrorCode.BACKUP_INVALID, "That backup could not be opened.");
	} finally {
		await probe.close().catch(() => undefined);
	}
}

/**
 * Starts the schedule, or explains why it is not running.
 *
 * Unref'd like the other upkeep timer, so a pending backup never holds the
 * process open during a shutdown.
 */
export function startBackupSchedule(): ReturnType<typeof setInterval> | null {
	const status = backupStatus();

	if (!config.backup.enabled) return null;
	if (!status.available) {
		logger.warn(`Backups are enabled but cannot run: ${status.reason}`);
		return null;
	}

	const run = async (): Promise<void> => {
		try {
			await createBackup();
		} catch (err) {
			logger.error("Scheduled backup failed", { error: String(err) });
		}
	};

	const timer = setInterval(() => void run(), status.intervalSeconds * 1000);
	timer.unref?.();

	logger.info(`Backups every ${status.intervalSeconds}s, keeping ${status.keep}`);
	return timer;
}
