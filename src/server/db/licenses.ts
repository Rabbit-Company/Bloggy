import { hash, uuid } from "../lib/crypto.ts";
import { isSqlite, now, sql } from "./index.ts";

const LICENSE_PREFIX = "BLOGGY";
const LICENSE_BYTES = 16;

export type LicenseStatus = "unused" | "active" | "expired" | "revoked";

export interface LicenseRow {
	id: string;
	key_hash: string;
	key_hint: string;
	duration_days: number;
	storage_bytes: number;
	custom_domain: number;
	created_by: string;
	created_at: string;
	redeemed_by: string | null;
	redeemed_at: string | null;
	expires_at: string | null;
	revoked_at: string | null;
}

export interface License {
	id: string;
	keyHint: string;
	durationDays: number;
	storageBytes: number;
	customDomain: boolean;
	createdBy: string;
	createdAt: string;
	redeemedBy: string | null;
	redeemedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	status: LicenseStatus;
}

export interface LicenseEntitlements {
	additionalStorage: number;
	customDomain: boolean;
	licenses: License[];
}

export interface CreateLicensesInput {
	count: number;
	durationDays: number;
	storageBytes: number;
	customDomain: boolean;
	createdBy: string;
}

export type RedeemLicenseResult = { status: "redeemed"; license: License } | { status: "invalid" } | { status: "used" };

function licenseStatus(row: LicenseRow, at: string): LicenseStatus {
	if (row.revoked_at !== null) return "revoked";
	if (row.redeemed_at === null || row.expires_at === null) return "unused";
	return row.expires_at > at ? "active" : "expired";
}

function toLicense(row: LicenseRow, at = now()): License {
	return {
		id: row.id,
		keyHint: row.key_hint,
		durationDays: Number(row.duration_days),
		storageBytes: Number(row.storage_bytes),
		customDomain: Number(row.custom_domain) === 1,
		createdBy: row.created_by,
		createdAt: row.created_at,
		redeemedBy: row.redeemed_by,
		redeemedAt: row.redeemed_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		status: licenseStatus(row, at),
	};
}

/** Keys carry random data only; their entitlements remain server-authoritative. */
export function generateLicenseKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(LICENSE_BYTES));
	const payload = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
	return `${LICENSE_PREFIX}-${payload.match(/.{1,8}/g)?.join("-") ?? payload}`;
}

export function normalizeLicenseKey(value: string): string {
	return value.trim().toUpperCase();
}

export function isLicenseKeyValid(value: unknown): value is string {
	return typeof value === "string" && /^BLOGGY(?:-[0-9A-F]{8}){4}$/i.test(value.trim());
}

function keyHint(key: string): string {
	return `${LICENSE_PREFIX}-...-${key.slice(-8)}`;
}

function likePattern(value: string): string {
	return `%${value.replace(/[!%_]/g, (char) => `!${char}`).toLowerCase()}%`;
}

function licenseSearchClause(search: string) {
	const term = search.trim();
	if (term.length === 0) return sql``;
	const pattern = likePattern(term);
	if (isLicenseKeyValid(term)) {
		const keyHash = hash(normalizeLicenseKey(term));
		return sql`WHERE (key_hash = ${keyHash} OR LOWER(key_hint) LIKE ${pattern} ESCAPE '!'
			OR LOWER(COALESCE(redeemed_by, '')) LIKE ${pattern} ESCAPE '!')`;
	}
	return sql`WHERE (LOWER(key_hint) LIKE ${pattern} ESCAPE '!'
		OR LOWER(COALESCE(redeemed_by, '')) LIKE ${pattern} ESCAPE '!')`;
}

export async function createLicenses(input: CreateLicensesInput): Promise<{ keys: string[]; licenses: License[] }> {
	const keys = Array.from({ length: input.count }, () => generateLicenseKey());
	const timestamp = now();
	const rows: LicenseRow[] = keys.map((key) => ({
		id: uuid(),
		key_hash: hash(key),
		key_hint: keyHint(key),
		duration_days: input.durationDays,
		storage_bytes: input.storageBytes,
		custom_domain: input.customDomain ? 1 : 0,
		created_by: input.createdBy,
		created_at: timestamp,
		redeemed_by: null,
		redeemed_at: null,
		expires_at: null,
		revoked_at: null,
	}));

	await sql.begin(async (transaction) => {
		for (const row of rows) await transaction`INSERT INTO licenses ${transaction({ ...row })}`;
	});

	return { keys, licenses: rows.map((row) => toLicense(row, timestamp)) };
}

export async function listLicenses(limit = 500, offset = 0, search = "", at = now()): Promise<License[]> {
	const rows = (await sql`SELECT * FROM licenses ${licenseSearchClause(search)}
		ORDER BY created_at DESC, id ASC LIMIT ${limit} OFFSET ${offset}`) as LicenseRow[];
	return rows.map((row) => toLicense(row, at));
}

export async function countLicenses(search = ""): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM licenses ${licenseSearchClause(search)}`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}

export async function listCreatorLicenses(username: string, at = now()): Promise<License[]> {
	const rows = (await sql`SELECT * FROM licenses WHERE redeemed_by = ${username} ORDER BY redeemed_at DESC`) as LicenseRow[];
	return rows.map((row) => toLicense(row, at));
}

export async function licenseEntitlements(username: string, at = now()): Promise<LicenseEntitlements> {
	const licenses = await listCreatorLicenses(username, at);
	const active = licenses.filter((license) => license.status === "active");
	return {
		additionalStorage: active.reduce((total, license) => total + license.storageBytes, 0),
		customDomain: active.some((license) => license.customDomain),
		licenses,
	};
}

/** Lightweight aggregate used on every upload, without loading license history. */
export async function additionalStorageAllowance(username: string, at = now()): Promise<number> {
	const rows = (await sql`SELECT COALESCE(SUM(storage_bytes), 0) AS total FROM licenses
		WHERE redeemed_by = ${username} AND revoked_at IS NULL AND expires_at > ${at}`) as { total: number | string }[];
	return Number(rows[0]?.total ?? 0);
}

/** Redeems once under a transaction so two requests cannot claim the same key. */
export async function redeemLicense(key: string, username: string, redeemedAt = now()): Promise<RedeemLicenseResult> {
	const keyHash = hash(normalizeLicenseKey(key));

	return await sql.begin(async (transaction) => {
		const rows = (
			isSqlite
				? await transaction`SELECT * FROM licenses WHERE key_hash = ${keyHash}`
				: await transaction`SELECT * FROM licenses WHERE key_hash = ${keyHash} FOR UPDATE`
		) as LicenseRow[];
		const row = rows[0];
		if (row === undefined || row.revoked_at !== null) return { status: "invalid" };
		if (row.redeemed_by !== null) return { status: "used" };

		const expiresAt = new Date(new Date(redeemedAt).getTime() + Number(row.duration_days) * 86_400_000).toISOString();
		await transaction`UPDATE licenses SET redeemed_by = ${username}, redeemed_at = ${redeemedAt}, expires_at = ${expiresAt}
			WHERE id = ${row.id} AND redeemed_by IS NULL AND revoked_at IS NULL`;

		return {
			status: "redeemed",
			license: toLicense({ ...row, redeemed_by: username, redeemed_at: redeemedAt, expires_at: expiresAt }, redeemedAt),
		};
	});
}

export async function revokeLicense(id: string, revokedAt = now()): Promise<number> {
	const result = await sql`UPDATE licenses SET revoked_at = ${revokedAt} WHERE id = ${id} AND revoked_at IS NULL`;
	const mutation = result as { affectedRows?: number | null; count?: number | null };
	return Number(mutation.affectedRows ?? mutation.count ?? 0);
}

/** Deleted accounts must not pass active entitlements to a later account reusing the username. */
export async function revokeLicensesByCreator(username: string): Promise<void> {
	await sql`UPDATE licenses SET revoked_at = ${now()} WHERE redeemed_by = ${username} AND revoked_at IS NULL`;
}
