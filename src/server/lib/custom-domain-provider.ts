import { resolveCname, resolveTxt } from "node:dns/promises";
import { config } from "../config.ts";
import type { CustomDomain, DomainVerificationRecord } from "../db/custom-domains.ts";
import { generateToken } from "./crypto.ts";

interface CloudflareEnvelope<T> {
	success: boolean;
	errors?: { message?: string }[];
	result: T;
}

interface CloudflareHostname {
	id: string;
	status?: string;
	ownership_verification?: { name?: string; value?: string };
	ssl?: {
		status?: string;
		validation_records?: { txt_name?: string; txt_value?: string; txt_record?: string }[];
	};
}

interface BurrowGateSiteResponse {
	site?: { id?: string };
}

interface BurrowGateTlsResponse {
	settings?: { mode?: string };
	certificate?: { status?: string; expiresAt?: number | null } | null;
}

function configured(): boolean {
	const provider = config.customDomains.provider;
	if (provider === "disabled") return false;
	if (config.customDomains.cnameTarget.length === 0) return false;
	if (provider === "manual") return true;
	if (provider === "cloudflare") {
		return (
			config.customDomains.cloudflare.apiToken.length > 0 &&
			config.customDomains.cloudflare.zoneId.length > 0 &&
			config.burrowgate.url.length > 0 &&
			config.customDomains.burrowgate.adminToken.length > 0 &&
			config.customDomains.burrowgate.originUrl.length > 0
		);
	}
	return config.burrowgate.url.length > 0 && config.customDomains.burrowgate.adminToken.length > 0 && config.customDomains.burrowgate.originUrl.length > 0;
}

export function customDomainsAvailable(): boolean {
	return configured();
}

function messageFrom(value: unknown, fallback: string): string {
	if (typeof value !== "object" || value === null) return fallback;
	const record = value as Record<string, unknown>;
	if (typeof record.error === "string") return record.error;
	if (Array.isArray(record.errors)) {
		const message = (record.errors[0] as { message?: unknown } | undefined)?.message;
		if (typeof message === "string") return message;
	}
	return fallback;
}

async function providerFetch<T>(url: string, init: RequestInit, fallback: string, allowNotFound = false, timeoutMs = 15_000): Promise<T | null> {
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (error) {
		throw new Error(`${fallback}: ${error instanceof Error ? error.message : "network error"}`);
	}

	if (allowNotFound && response.status === 404) return null;
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// The status below remains enough to report a useful provider failure.
	}
	if (!response.ok) throw new Error(`${fallback}: ${messageFrom(body, `HTTP ${response.status}`)}`);
	return body as T;
}

function cloudflareUrl(path: string): string {
	return `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.customDomains.cloudflare.zoneId)}${path}`;
}

function cloudflareHeaders(): HeadersInit {
	return { Authorization: `Bearer ${config.customDomains.cloudflare.apiToken}`, "Content-Type": "application/json" };
}

function cloudflareRecords(hostname: CloudflareHostname): DomainVerificationRecord[] {
	const records: DomainVerificationRecord[] = [];
	const ownership = hostname.ownership_verification;
	if (ownership?.name && ownership.value) records.push({ type: "TXT", name: ownership.name, value: ownership.value });
	for (const record of hostname.ssl?.validation_records ?? []) {
		const value = record.txt_value ?? record.txt_record;
		if (record.txt_name && value && !records.some((entry) => entry.name === record.txt_name && entry.value === value)) {
			records.push({ type: "TXT", name: record.txt_name, value });
		}
	}
	return records;
}

export async function createCloudflareHostname(hostname: string): Promise<{ id: string; records: DomainVerificationRecord[] }> {
	const envelope = await providerFetch<CloudflareEnvelope<CloudflareHostname>>(
		cloudflareUrl("/custom_hostnames"),
		{
			method: "POST",
			headers: cloudflareHeaders(),
			body: JSON.stringify({ hostname, ssl: { method: "txt", type: "dv" } }),
		},
		"Cloudflare could not create the custom hostname",
	);
	if (!envelope?.success || typeof envelope.result?.id !== "string") throw new Error("Cloudflare returned an incomplete custom hostname response");
	return { id: envelope.result.id, records: cloudflareRecords(envelope.result) };
}

export async function readCloudflareHostname(id: string): Promise<{ hostnameReady: boolean; certificateReady: boolean; records: DomainVerificationRecord[] }> {
	const envelope = await providerFetch<CloudflareEnvelope<CloudflareHostname>>(
		cloudflareUrl(`/custom_hostnames/${encodeURIComponent(id)}`),
		{ headers: cloudflareHeaders() },
		"Cloudflare could not read the custom hostname",
	);
	if (!envelope?.success) throw new Error("Cloudflare returned an invalid custom hostname response");
	return {
		hostnameReady: envelope.result.status === "active",
		certificateReady: envelope.result.ssl?.status === "active",
		records: cloudflareRecords(envelope.result),
	};
}

export async function deleteCloudflareHostname(id: string): Promise<void> {
	await providerFetch(
		cloudflareUrl(`/custom_hostnames/${encodeURIComponent(id)}`),
		{ method: "DELETE", headers: cloudflareHeaders() },
		"Cloudflare could not remove the custom hostname",
		true,
	);
}

function burrowGateUrl(path: string): string {
	return `${config.burrowgate.url}${path}`;
}

function burrowGateHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${config.customDomains.burrowgate.adminToken}`,
		"Content-Type": "application/json",
		"X-BurrowGate-Admin": "1",
		Origin: config.burrowgate.url,
	};
}

export async function createBurrowGateSite(hostname: string, behindCloudflare = false): Promise<string> {
	if (config.burrowgate.url.length === 0) throw new Error("BURROWGATE_URL is required for automatic custom domains");
	const body = await providerFetch<BurrowGateSiteResponse>(
		burrowGateUrl("/_burrowgate/api/admin/sites"),
		{
			method: "POST",
			headers: burrowGateHeaders(),
			body: JSON.stringify({
				name: `Bloggy custom domain ${hostname}`,
				publicHost: hostname,
				originUrl: config.customDomains.burrowgate.originUrl,
				enabled: true,
				defaultAccessMode: "bypass",
				ipExtractionPreset: behindCloudflare ? "cloudflare" : "direct",
			}),
		},
		"BurrowGate could not create the custom-domain site",
	);
	const id = body?.site?.id;
	if (typeof id !== "string" || id.length === 0) throw new Error("BurrowGate returned an incomplete site response");
	return id;
}

export async function burrowGateCertificateReady(siteId: string): Promise<boolean> {
	const body = await providerFetch<BurrowGateTlsResponse>(
		burrowGateUrl(`/_burrowgate/api/admin/sites/${encodeURIComponent(siteId)}/tls`),
		{ headers: burrowGateHeaders() },
		"BurrowGate could not read the custom-domain certificate",
	);
	return body?.settings?.mode === "letsencrypt" && body.certificate?.status === "active";
}

export async function issueBurrowGateCertificate(siteId: string): Promise<void> {
	await providerFetch(
		burrowGateUrl(`/_burrowgate/api/admin/sites/${encodeURIComponent(siteId)}/certificate/letsencrypt`),
		{
			method: "POST",
			headers: burrowGateHeaders(),
			body: JSON.stringify({ email: config.customDomains.burrowgate.acmeEmail || undefined, forceHttps: true, termsAccepted: true }),
		},
		"BurrowGate could not issue the custom-domain certificate",
		false,
		120_000,
	);
}

export async function deleteBurrowGateSite(siteId: string): Promise<void> {
	await providerFetch(
		burrowGateUrl(`/_burrowgate/api/admin/sites/${encodeURIComponent(siteId)}`),
		{ method: "DELETE", headers: burrowGateHeaders() },
		"BurrowGate could not remove the custom-domain site",
		true,
	);
}

export async function deleteCustomDomainResources(domain: CustomDomain): Promise<void> {
	const operations: Promise<void>[] = [];
	if (domain.provider === "cloudflare" && domain.providerHostnameId) operations.push(deleteCloudflareHostname(domain.providerHostnameId));
	if (domain.provider !== "manual" && domain.gatewaySiteId) operations.push(deleteBurrowGateSite(domain.gatewaySiteId));
	const results = await Promise.allSettled(operations);
	const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
	if (failed) throw failed.reason;
}

export function manualVerificationRecord(hostname: string): DomainVerificationRecord {
	return { type: "TXT", name: `_bloggy-verify.${hostname}`, value: `bloggy-${generateToken(48)}` };
}

export async function dnsRecordsReady(domain: CustomDomain): Promise<boolean> {
	const requiredTxt = domain.verificationRecords.filter((record) => record.type === "TXT");
	try {
		const [cnames, ...txtAnswers] = await Promise.all([resolveCname(domain.hostname), ...requiredTxt.map((record) => resolveTxt(record.name))]);
		const target = config.customDomains.cnameTarget.toLowerCase().replace(/\.$/, "");
		if (!cnames.some((record) => record.toLowerCase().replace(/\.$/, "") === target)) return false;
		return requiredTxt.every((record, index) => txtAnswers[index]?.some((parts) => parts.join("") === record.value));
	} catch {
		return false;
	}
}
