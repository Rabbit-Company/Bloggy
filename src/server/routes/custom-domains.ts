import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import {
	deleteCustomDomain,
	findCustomDomainByHostname,
	findCustomDomainByUsername,
	insertCustomDomain,
	updateCustomDomain,
	type CustomDomain,
} from "../db/custom-domains.ts";
import { licenseEntitlements } from "../db/licenses.ts";
import {
	burrowGateCertificateReady,
	createBurrowGateSite,
	createCloudflareHostname,
	customDomainsAvailable,
	deleteBurrowGateSite,
	deleteCustomDomainResources,
	dnsRecordsReady,
	issueBurrowGateCertificate,
	manualVerificationRecord,
	readCloudflareHostname,
	syncBurrowGateSite,
} from "../lib/custom-domain-provider.ts";
import { isReservedCustomHostname, normalizeCustomHostname } from "../lib/custom-domain-host.ts";
import { uuid } from "../lib/crypto.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { requireOwner } from "../middleware/auth.ts";
import { invalidateCreator } from "../middleware/cache.ts";
import { accountRateLimit } from "../middleware/account-rate-limit.ts";
import type { AppContext, AppState } from "../types.ts";
import { now } from "../db/index.ts";

function publicDomain(domain: CustomDomain | null, entitled: boolean) {
	if (domain === null) return null;
	return {
		hostname: domain.hostname,
		status: entitled ? domain.status : "disabled",
		verificationRecords: domain.verificationRecords,
		lastError: domain.lastError,
		createdAt: domain.createdAt,
		updatedAt: domain.updatedAt,
		activatedAt: domain.activatedAt,
	};
}

async function response(ctx: AppContext, username: string): Promise<Response> {
	const [domain, entitlements] = await Promise.all([findCustomDomainByUsername(username), licenseEntitlements(username)]);
	return ok(ctx, {
		available: customDomainsAvailable(),
		provider: config.customDomains.provider,
		cnameTarget: config.customDomains.cnameTarget,
		entitled: entitlements.customDomain,
		domain: publicDomain(domain, entitlements.customDomain),
	});
}

async function requireEntitled(username: string): Promise<void> {
	if (!(await licenseEntitlements(username)).customDomain) throw new ApiError(ErrorCode.CUSTOM_DOMAIN_UNAVAILABLE);
	if (!customDomainsAvailable()) throw new ApiError(ErrorCode.CUSTOM_DOMAIN_UNAVAILABLE, "Custom domains are not configured on this installation.");
}

async function refreshDomain(domain: CustomDomain): Promise<CustomDomain> {
	try {
		let gatewayReady = false;
		let records = domain.verificationRecords;

		if (domain.provider === "cloudflare") {
			if (!domain.providerHostnameId) throw new Error("The Cloudflare hostname identifier is missing");
			const cloudflare = await readCloudflareHostname(domain.providerHostnameId);
			records = cloudflare.records.length > 0 ? cloudflare.records : records;
			gatewayReady = cloudflare.hostnameReady && cloudflare.certificateReady;
		} else {
			gatewayReady = await dnsRecordsReady(domain);
		}

		if (!gatewayReady) {
			return await updateCustomDomain(domain.id, { status: "pending", verificationRecords: records, lastError: null });
		}

		if (domain.provider === "manual") {
			return await updateCustomDomain(domain.id, { status: "active", verificationRecords: records, lastError: null, activatedAt: domain.activatedAt ?? now() });
		}

		let siteId = domain.gatewaySiteId;
		if (!siteId) {
			siteId = await createBurrowGateSite(domain.hostname, domain.provider === "cloudflare");
			try {
				domain = await updateCustomDomain(domain.id, { status: "provisioning", gatewaySiteId: siteId, verificationRecords: records, lastError: null });
			} catch (error) {
				await deleteBurrowGateSite(siteId).catch(() => undefined);
				throw error;
			}
		} else {
			await syncBurrowGateSite(siteId);
		}

		if (!(await burrowGateCertificateReady(siteId))) await issueBurrowGateCertificate(siteId);
		if (!(await burrowGateCertificateReady(siteId))) {
			return await updateCustomDomain(domain.id, { status: "provisioning", verificationRecords: records, lastError: null });
		}

		return await updateCustomDomain(domain.id, {
			status: "active",
			verificationRecords: records,
			lastError: null,
			activatedAt: domain.activatedAt ?? now(),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Custom-domain provisioning failed";
		await updateCustomDomain(domain.id, { status: "error", lastError: message });
		throw new ApiError(ErrorCode.CUSTOM_DOMAIN_PROVISIONING_FAILED, message);
	}
}

export async function removeExternalCustomDomain(domain: CustomDomain): Promise<void> {
	await deleteCustomDomainResources(domain);
}

export function customDomainRoutes(app: Web<AppState>): void {
	app.get("/api/v1/custom-domain", requireOwner(), accountRateLimit("custom-domain.read", "read"), async (ctx) => {
		return await response(ctx, ctx.get("creator").username);
	});

	app.post("/api/v1/custom-domain", requireOwner(), accountRateLimit("custom-domain.create", "security"), async (ctx) => {
		const username = ctx.get("creator").username;
		await requireEntitled(username);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["hostname"]);
		const hostname = normalizeCustomHostname(body.hostname);
		if (!hostname || isReservedCustomHostname(hostname)) throw new ApiError(ErrorCode.INVALID_CUSTOM_DOMAIN);

		if (await findCustomDomainByUsername(username)) {
			throw new ApiError(ErrorCode.CUSTOM_DOMAIN_CONFLICT, "Remove your current custom domain before connecting another one.");
		}
		if (await findCustomDomainByHostname(hostname)) throw new ApiError(ErrorCode.CUSTOM_DOMAIN_CONFLICT);

		const provider = config.customDomains.provider;
		if (provider === "disabled") throw new ApiError(ErrorCode.CUSTOM_DOMAIN_UNAVAILABLE);
		let providerHostnameId: string | null = null;
		const gatewaySiteId: string | null = null;
		let verificationRecords = provider === "cloudflare" ? [] : [manualVerificationRecord(hostname)];

		try {
			if (provider === "cloudflare") {
				const cloudflare = await createCloudflareHostname(hostname);
				providerHostnameId = cloudflare.id;
				verificationRecords = cloudflare.records;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Custom-domain provisioning failed";
			throw new ApiError(ErrorCode.CUSTOM_DOMAIN_PROVISIONING_FAILED, message);
		}

		const timestamp = now();
		const domain: CustomDomain = {
			id: uuid(),
			username,
			hostname,
			provider,
			status: "pending",
			providerHostnameId,
			gatewaySiteId,
			verificationRecords,
			lastError: null,
			createdAt: timestamp,
			updatedAt: timestamp,
			activatedAt: null,
		};
		try {
			await insertCustomDomain(domain);
		} catch (error) {
			await removeExternalCustomDomain(domain).catch(() => undefined);
			if (await findCustomDomainByHostname(hostname)) throw new ApiError(ErrorCode.CUSTOM_DOMAIN_CONFLICT);
			throw error;
		}

		logger.audit("Custom domain connected", { username, hostname, provider });
		return await response(ctx, username);
	});

	app.post("/api/v1/custom-domain/refresh", requireOwner(), accountRateLimit("custom-domain.refresh", "security"), async (ctx) => {
		const username = ctx.get("creator").username;
		await requireEntitled(username);
		const domain = await findCustomDomainByUsername(username);
		if (!domain) throw new ApiError(ErrorCode.NOT_FOUND, "No custom domain is connected.");
		const refreshed = await refreshDomain(domain);
		if (refreshed.status === "active") invalidateCreator(username);
		return await response(ctx, username);
	});

	app.delete("/api/v1/custom-domain", requireOwner(), accountRateLimit("custom-domain.delete", "critical"), async (ctx) => {
		const username = ctx.get("creator").username;
		const domain = await findCustomDomainByUsername(username);
		if (!domain) throw new ApiError(ErrorCode.NOT_FOUND, "No custom domain is connected.");
		try {
			await removeExternalCustomDomain(domain);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Custom-domain removal failed";
			await updateCustomDomain(domain.id, { status: "error", lastError: message });
			throw new ApiError(ErrorCode.CUSTOM_DOMAIN_PROVISIONING_FAILED, message);
		}
		await deleteCustomDomain(domain.id);
		invalidateCreator(username);
		logger.audit("Custom domain removed", { username, hostname: domain.hostname });
		return ok(ctx);
	});
}
