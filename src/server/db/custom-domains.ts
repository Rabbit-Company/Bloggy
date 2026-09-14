import { now, sql } from "./index.ts";

export type CustomDomainStatus = "pending" | "provisioning" | "active" | "error" | "disabled";
export type CustomDomainProvider = "cloudflare" | "burrowgate" | "manual";

export interface DomainVerificationRecord {
	type: "TXT" | "CNAME";
	name: string;
	value: string;
}

export interface CustomDomainRow {
	id: string;
	username: string;
	hostname: string;
	provider: CustomDomainProvider;
	status: CustomDomainStatus;
	provider_hostname_id: string | null;
	gateway_site_id: string | null;
	verification_records: string;
	last_error: string | null;
	created_at: string;
	updated_at: string;
	activated_at: string | null;
}

export interface CustomDomain {
	id: string;
	username: string;
	hostname: string;
	provider: CustomDomainProvider;
	status: CustomDomainStatus;
	providerHostnameId: string | null;
	gatewaySiteId: string | null;
	verificationRecords: DomainVerificationRecord[];
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
	activatedAt: string | null;
}

function verificationRecords(value: string): DomainVerificationRecord[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(record): record is DomainVerificationRecord =>
				typeof record === "object" &&
				record !== null &&
				((record as DomainVerificationRecord).type === "TXT" || (record as DomainVerificationRecord).type === "CNAME") &&
				typeof (record as DomainVerificationRecord).name === "string" &&
				typeof (record as DomainVerificationRecord).value === "string",
		);
	} catch {
		return [];
	}
}

export function toCustomDomain(row: CustomDomainRow): CustomDomain {
	return {
		id: row.id,
		username: row.username,
		hostname: row.hostname,
		provider: row.provider,
		status: row.status,
		providerHostnameId: row.provider_hostname_id,
		gatewaySiteId: row.gateway_site_id,
		verificationRecords: verificationRecords(row.verification_records),
		lastError: row.last_error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		activatedAt: row.activated_at,
	};
}

export async function findCustomDomainByUsername(username: string): Promise<CustomDomain | null> {
	const rows = (await sql`SELECT * FROM custom_domains WHERE username = ${username} LIMIT 1`) as CustomDomainRow[];
	return rows[0] ? toCustomDomain(rows[0]) : null;
}

export async function findCustomDomainByHostname(hostname: string): Promise<CustomDomain | null> {
	const rows = (await sql`SELECT * FROM custom_domains WHERE hostname = ${hostname} LIMIT 1`) as CustomDomainRow[];
	return rows[0] ? toCustomDomain(rows[0]) : null;
}

export async function findActiveCustomDomainByHostname(hostname: string, at = now()): Promise<CustomDomain | null> {
	const rows = (await sql`SELECT d.* FROM custom_domains d
		JOIN creators c ON c.username = d.username
		WHERE d.hostname = ${hostname}
			AND d.status = 'active'
			AND c.suspended_at IS NULL
			AND c.email_verified_at IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM licenses l
				WHERE l.redeemed_by = d.username
					AND l.custom_domain = 1
					AND l.revoked_at IS NULL
					AND l.expires_at > ${at}
			)
		LIMIT 1`) as CustomDomainRow[];
	return rows[0] ? toCustomDomain(rows[0]) : null;
}

export async function findActiveCustomDomainByUsername(username: string, at = now()): Promise<CustomDomain | null> {
	const rows = (await sql`SELECT d.* FROM custom_domains d
		JOIN creators c ON c.username = d.username
		WHERE d.username = ${username}
			AND d.status = 'active'
			AND c.suspended_at IS NULL
			AND c.email_verified_at IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM licenses l
				WHERE l.redeemed_by = d.username
					AND l.custom_domain = 1
					AND l.revoked_at IS NULL
					AND l.expires_at > ${at}
			)
		LIMIT 1`) as CustomDomainRow[];
	return rows[0] ? toCustomDomain(rows[0]) : null;
}

export async function insertCustomDomain(domain: CustomDomain): Promise<void> {
	await sql`INSERT INTO custom_domains ${sql({
		id: domain.id,
		username: domain.username,
		hostname: domain.hostname,
		provider: domain.provider,
		status: domain.status,
		provider_hostname_id: domain.providerHostnameId,
		gateway_site_id: domain.gatewaySiteId,
		verification_records: JSON.stringify(domain.verificationRecords),
		last_error: domain.lastError,
		created_at: domain.createdAt,
		updated_at: domain.updatedAt,
		activated_at: domain.activatedAt,
	})}`;
}

export async function updateCustomDomain(
	id: string,
	changes: Partial<Pick<CustomDomain, "status" | "providerHostnameId" | "gatewaySiteId" | "verificationRecords" | "lastError" | "activatedAt">>,
): Promise<CustomDomain> {
	const existingRows = (await sql`SELECT * FROM custom_domains WHERE id = ${id} LIMIT 1`) as CustomDomainRow[];
	const existing = existingRows[0];
	if (!existing) throw new Error("Custom domain not found");

	const updatedAt = now();
	await sql`UPDATE custom_domains SET ${sql({
		status: changes.status ?? existing.status,
		provider_hostname_id: changes.providerHostnameId === undefined ? existing.provider_hostname_id : changes.providerHostnameId,
		gateway_site_id: changes.gatewaySiteId === undefined ? existing.gateway_site_id : changes.gatewaySiteId,
		verification_records: changes.verificationRecords === undefined ? existing.verification_records : JSON.stringify(changes.verificationRecords),
		last_error: changes.lastError === undefined ? existing.last_error : changes.lastError,
		activated_at: changes.activatedAt === undefined ? existing.activated_at : changes.activatedAt,
		updated_at: updatedAt,
	})} WHERE id = ${id}`;

	return toCustomDomain({
		...existing,
		status: changes.status ?? existing.status,
		provider_hostname_id: changes.providerHostnameId === undefined ? existing.provider_hostname_id : changes.providerHostnameId,
		gateway_site_id: changes.gatewaySiteId === undefined ? existing.gateway_site_id : changes.gatewaySiteId,
		verification_records: changes.verificationRecords === undefined ? existing.verification_records : JSON.stringify(changes.verificationRecords),
		last_error: changes.lastError === undefined ? existing.last_error : changes.lastError,
		activated_at: changes.activatedAt === undefined ? existing.activated_at : changes.activatedAt,
		updated_at: updatedAt,
	});
}

export async function deleteCustomDomain(id: string): Promise<void> {
	await sql`DELETE FROM custom_domains WHERE id = ${id}`;
}

export async function deleteCustomDomainByUsername(username: string): Promise<void> {
	await sql`DELETE FROM custom_domains WHERE username = ${username}`;
}
