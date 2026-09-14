import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createSession } from "../src/server/auth/sessions.ts";
import { config, type CustomDomainProvider } from "../src/server/config.ts";
import { createApp } from "../src/server/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { insertCreator } from "../src/server/db/creators.ts";
import { insertPost } from "../src/server/db/posts.ts";
import { createLicenses, redeemLicense, revokeLicense } from "../src/server/db/licenses.ts";
import { findCustomDomainByUsername, insertCustomDomain, updateCustomDomain } from "../src/server/db/custom-domains.ts";
import { now, sql } from "../src/server/db/index.ts";
import { normalizeCustomHostname } from "../src/server/lib/custom-domain-host.ts";
import { burrowGateCertificateReady, customDomainsAvailable } from "../src/server/lib/custom-domain-provider.ts";

const USER = "domain-owner";
const HOSTNAME = "blog.rabbit-company.com";
const PICTURE = "00000000-0000-4000-8000-000000000001";
const originalProvider = config.customDomains.provider;
const originalCnameTarget = config.customDomains.cnameTarget;

function customDomainConfig(provider: CustomDomainProvider, cnameTarget: string): void {
	(config.customDomains as { provider: CustomDomainProvider; cnameTarget: string }).provider = provider;
	(config.customDomains as { provider: CustomDomainProvider; cnameTarget: string }).cnameTarget = cnameTarget;
}

function account() {
	return {
		username: USER,
		password: "unused",
		email: `${USER}@example.com`,
		title: "Rabbit Company Journal",
		description: "Independent articles from the Rabbit Company community and its members.",
		author: "Rabbit Company Author",
		category: "Technology",
		language: "en",
		theme: "light",
	};
}

async function activateDomain(provider: "cloudflare" | "burrowgate" | "manual" = "manual") {
	const generated = await createLicenses({ count: 1, durationDays: 30, storageBytes: 0, customDomain: true, createdBy: "test-admin" });
	await redeemLicense(generated.keys[0]!, USER);
	const timestamp = now();
	await insertCustomDomain({
		id: crypto.randomUUID(),
		username: USER,
		hostname: HOSTNAME,
		provider,
		status: "active",
		providerHostnameId: null,
		gatewaySiteId: null,
		verificationRecords: [],
		lastError: null,
		createdAt: timestamp,
		updatedAt: timestamp,
		activatedAt: timestamp,
	});
	return generated.licenses[0]!;
}

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	customDomainConfig(originalProvider, originalCnameTarget);
	await sql`DELETE FROM custom_domains WHERE username = ${USER}`;
	await sql`DELETE FROM licenses WHERE redeemed_by = ${USER} OR created_by = 'test-admin'`;
	await sql`DELETE FROM sessions WHERE username = ${USER}`;
	await sql`DELETE FROM posts WHERE username = ${USER}`;
	await sql`DELETE FROM creators WHERE username = ${USER}`;
	await insertCreator(account());
	await insertPost(
		USER,
		{
			slug: "first-story",
			title: "The first Rabbit Company story",
			description: "A complete description for the first story published by Rabbit Company.",
			picture: PICTURE,
			markdown: `A public story with enough content for the custom domain routing test.\n\n![Stored image](${config.storage.cdnUrl}/images/${USER}/${PICTURE})`,
			category: "Technology",
			language: "en",
			tag: "Community",
			keywords: "rabbit,company,community,story",
			status: "published",
		},
		12,
		1,
	);
});

afterAll(() => {
	customDomainConfig(originalProvider, originalCnameTarget);
});

describe("custom domain hostnames", () => {
	test("normalizes international hostnames and rejects URLs, ports and private names", () => {
		expect(normalizeCustomHostname("Blog.Example.com.")).toBe("blog.example.com");
		expect(normalizeCustomHostname("münich.example")).toBe("xn--mnich-kva.example");
		expect(normalizeCustomHostname("https://blog.example.com")).toBeNull();
		expect(normalizeCustomHostname("blog.example.com:8443")).toBeNull();
		expect(normalizeCustomHostname("localhost")).toBeNull();
		expect(normalizeCustomHostname("127.0.0.1")).toBeNull();
	});

	test("serves health checks addressed directly to the private origin", async () => {
		const response = await createApp().handle(new Request("http://127.0.0.1:3000/health"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok", database: config.database.dialect });
	});

	test("recognizes BurrowGate's active certificate response", async () => {
		const originalFetch = globalThis.fetch;
		const originalUrl = config.burrowgate.url;
		const originalToken = config.customDomains.burrowgate.adminToken;
		(config.burrowgate as { url: string }).url = "https://gateway.example.test";
		(config.customDomains.burrowgate as { adminToken: string }).adminToken = "test-token";
		globalThis.fetch = (async (input, init) => {
			expect(String(input)).toBe("https://gateway.example.test/_burrowgate/api/admin/sites/site-1/tls");
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
			return Response.json({ settings: { mode: "letsencrypt" }, certificate: { status: "active" } });
		}) as typeof fetch;

		try {
			expect(await burrowGateCertificateReady("site-1")).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
			(config.burrowgate as { url: string }).url = originalUrl;
			(config.customDomains.burrowgate as { adminToken: string }).adminToken = originalToken;
		}
	});

	test("requires both Cloudflare and BurrowGate credentials in hosted mode", () => {
		const originalUrl = config.burrowgate.url;
		const originalToken = config.customDomains.cloudflare.apiToken;
		const originalZone = config.customDomains.cloudflare.zoneId;
		const originalAdminToken = config.customDomains.burrowgate.adminToken;
		const originalOriginUrl = config.customDomains.burrowgate.originUrl;
		try {
			customDomainConfig("cloudflare", "customers.bloggy.test");
			(config.burrowgate as { url: string }).url = "https://gateway.example.test";
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).apiToken = "cloudflare-token";
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).zoneId = "zone-id";
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).adminToken = "burrowgate-token";
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).originUrl = "http://127.0.0.1:3000";
			expect(customDomainsAvailable()).toBe(true);
			(config.customDomains.burrowgate as { adminToken: string }).adminToken = "";
			expect(customDomainsAvailable()).toBe(false);
		} finally {
			(config.burrowgate as { url: string }).url = originalUrl;
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).apiToken = originalToken;
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).zoneId = originalZone;
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).adminToken = originalAdminToken;
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).originUrl = originalOriginUrl;
			customDomainConfig(originalProvider, originalCnameTarget);
		}
	});

	test("provisions Cloudflare and BurrowGate resources for a hosted domain", async () => {
		const originalFetch = globalThis.fetch;
		const originalUrl = config.burrowgate.url;
		const originalSiteId = config.burrowgate.siteId;
		const originalCloudflareToken = config.customDomains.cloudflare.apiToken;
		const originalZone = config.customDomains.cloudflare.zoneId;
		const originalAdminToken = config.customDomains.burrowgate.adminToken;
		const originalOriginUrl = config.customDomains.burrowgate.originUrl;
		let tlsReads = 0;
		let siteListReads = 0;

		try {
			customDomainConfig("cloudflare", "customers.bloggy.test");
			(config.burrowgate as { url: string; siteId: string }).url = "https://gateway.example.test";
			(config.burrowgate as { url: string; siteId: string }).siteId = "main-site-id";
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).apiToken = "cloudflare-token";
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).zoneId = "zone-id";
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).adminToken = "burrowgate-token";
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).originUrl = "https://bloggy.io";

			globalThis.fetch = (async (input, init) => {
				const url = String(input);
				const method = init?.method ?? "GET";
				if (url.endsWith("/custom_hostnames") && method === "POST") {
					return Response.json({
						success: true,
						result: { id: "cf-hostname-1", ownership_verification: { name: `_cf-custom-hostname.${HOSTNAME}`, value: "ownership-token" } },
					});
				}
				if (url.endsWith("/custom_hostnames/cf-hostname-1")) {
					return Response.json({ success: true, result: { id: "cf-hostname-1", status: "active", ssl: { status: "active" } } });
				}
				if (url.endsWith("/_burrowgate/api/admin/sites") && method === "GET") {
					siteListReads++;
					return Response.json({
						items: [{ id: "main-site-id", name: "Bloggy", publicHost: "bloggy.io", originUrl: "http://localhost:3000" }],
					});
				}
				if (url.endsWith("/_burrowgate/api/admin/sites") && method === "POST") {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					expect(body).toMatchObject({
						name: HOSTNAME,
						publicHost: HOSTNAME,
						originUrl: "http://localhost:3000",
						ipExtractionPreset: "cloudflare",
					});
					expect(body).not.toHaveProperty("challengePolicy");
					return Response.json({ site: { id: "burrowgate-site-1" } });
				}
				if (url.endsWith("/sites/burrowgate-site-1/tls")) {
					tlsReads++;
					return Response.json(
						tlsReads === 1 ? { settings: { mode: "selfsigned" }, certificate: null } : { settings: { mode: "letsencrypt" }, certificate: { status: "active" } },
					);
				}
				if (url.endsWith("/sites/burrowgate-site-1/certificate/letsencrypt") && method === "POST") return Response.json({ success: true });
				throw new Error(`Unexpected provider request: ${method} ${url}`);
			}) as typeof fetch;

			const generated = await createLicenses({ count: 1, durationDays: 30, storageBytes: 0, customDomain: true, createdBy: "test-admin" });
			await redeemLicense(generated.keys[0]!, USER);
			const session = await createSession(USER);
			const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
			const app = createApp();
			const connected = await app.handle(
				new Request("http://localhost:3000/api/v1/custom-domain", { method: "POST", headers, body: JSON.stringify({ hostname: HOSTNAME }) }),
			);
			expect(connected.status).toBe(200);

			const refreshed = await app.handle(
				new Request("http://localhost:3000/api/v1/custom-domain/refresh", { method: "POST", headers: { Authorization: `Bearer ${session.token}` } }),
			);
			expect(refreshed.status).toBe(200);
			expect((await refreshed.json()) as unknown).toMatchObject({ data: { domain: { hostname: HOSTNAME, status: "active" } } });
			expect(await findCustomDomainByUsername(USER)).toMatchObject({
				providerHostnameId: "cf-hostname-1",
				gatewaySiteId: "burrowgate-site-1",
				status: "active",
			});

			const checkedAgain = await app.handle(
				new Request("http://localhost:3000/api/v1/custom-domain/refresh", { method: "POST", headers: { Authorization: `Bearer ${session.token}` } }),
			);
			expect(checkedAgain.status).toBe(200);
			expect(siteListReads).toBe(1);
			expect(tlsReads).toBe(3);
		} finally {
			globalThis.fetch = originalFetch;
			(config.burrowgate as { url: string; siteId: string }).url = originalUrl;
			(config.burrowgate as { url: string; siteId: string }).siteId = originalSiteId;
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).apiToken = originalCloudflareToken;
			(config.customDomains.cloudflare as { apiToken: string; zoneId: string }).zoneId = originalZone;
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).adminToken = originalAdminToken;
			(config.customDomains.burrowgate as { adminToken: string; originUrl: string }).originUrl = originalOriginUrl;
			customDomainConfig(originalProvider, originalCnameTarget);
		}
	});

	test("serves the creator at the custom-domain root without Bloggy branding", async () => {
		await activateDomain();
		const response = await createApp().handle(new Request(`https://${HOSTNAME}/`));
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain("Rabbit Company Journal");
		expect(html).toContain(`<link rel="canonical" href="https://${HOSTNAME}">`);
		expect(html).toContain('href="/first-story"');
		expect(html).toContain(`src="https://${HOSTNAME}/media/avatars/${USER}"`);
		expect(html).toContain(`src="https://${HOSTNAME}/media/images/${USER}/${PICTURE}"`);
		expect(html).not.toContain(`/creator/${USER}`);
		expect(html).not.toContain("http://localhost:3000/media/");
		expect(html).not.toContain("Powered by");
	});

	test("serves posts and feeds directly under the custom hostname", async () => {
		await activateDomain();
		const app = createApp();
		const post = await app.handle(new Request(`https://${HOSTNAME}/first-story`));
		const postHtml = await post.text();
		expect(post.status).toBe(200);
		expect(postHtml).toContain(`<meta property="og:url" content="https://${HOSTNAME}/first-story">`);
		expect(postHtml).toContain(`src="https://${HOSTNAME}/media/images/${USER}/${PICTURE}"`);
		expect(postHtml).not.toContain(`/creator/${USER}`);

		const feed = await app.handle(new Request(`https://${HOSTNAME}/feed.json`));
		expect(feed.status).toBe(200);
		expect(await feed.text()).toContain(`"home_page_url":"https://${HOSTNAME}"`);
	});

	test("does not expose panel or API routes on a creator hostname", async () => {
		await activateDomain();
		const app = createApp();
		const panel = await app.handle(new Request(`https://${HOSTNAME}/panel`));
		const api = await app.handle(new Request(`https://${HOSTNAME}/api/v1/config`));
		const otherMedia = await app.handle(new Request(`https://${HOSTNAME}/media/images/somebody-else/${PICTURE}`));
		expect(panel.status).toBe(404);
		expect(api.status).toBe(404);
		expect(otherMedia.status).toBe(404);
		expect(await panel.text()).toBe("Not found");
	});

	test("keeps main and custom root responses in separate cache entries", async () => {
		await activateDomain();
		const app = createApp();
		const main = await app.handle(new Request("http://localhost:3000/"));
		const custom = await app.handle(new Request(`https://${HOSTNAME}/`));
		expect(await main.text()).toContain("Independent voices");
		expect(await custom.text()).toContain("Rabbit Company Journal");
	});

	test("serves a Cloudflare custom hostname directly and ignores proxy identity headers", async () => {
		await activateDomain("cloudflare");
		const app = createApp();
		const direct = await app.handle(new Request(`https://${HOSTNAME}/`));
		const spoofed = await app.handle(
			new Request("https://fallback.bloggy.test/", {
				headers: { "X-Bloggy-Custom-Hostname": HOSTNAME, "X-Bloggy-Custom-Token": "ignored" },
			}),
		);

		expect(direct.status).toBe(200);
		expect(await direct.text()).toContain("Rabbit Company Journal");
		expect(spoofed.status).toBe(404);
	});

	test("redirects the original creator pages and feeds to the active custom domain", async () => {
		await activateDomain();
		const app = createApp();
		const listing = await app.handle(new Request(`http://localhost:3000/creator/${USER}?tag=Community&page=2`));
		const post = await app.handle(new Request(`http://localhost:3000/creator/${USER}/first-story?source=legacy`));
		const feed = await app.handle(new Request(`http://localhost:3000/creator/${USER}/feed.rss`));

		expect(listing.status).toBe(302);
		expect(listing.headers.get("Location")).toBe(`https://${HOSTNAME}/?tag=Community&page=2`);
		expect(listing.headers.get("Cache-Control")).toBe("no-store");
		expect(post.status).toBe(302);
		expect(post.headers.get("Location")).toBe(`https://${HOSTNAME}/first-story?source=legacy`);
		expect(feed.status).toBe(302);
		expect(feed.headers.get("Location")).toBe(`https://${HOSTNAME}/feed.rss`);
	});

	test("uses the custom BurrowGate site and root paths for analytics", async () => {
		await activateDomain("cloudflare");
		const domain = await findCustomDomainByUsername(USER);
		expect(domain).not.toBeNull();
		await updateCustomDomain(domain!.id, { gatewaySiteId: "custom-site-id" });

		const originalFetch = globalThis.fetch;
		const originalUrl = config.burrowgate.url;
		const originalToken = config.burrowgate.token;
		const originalSiteId = config.burrowgate.siteId;
		const requests: URL[] = [];

		try {
			(config.burrowgate as { url: string; token: string; siteId: string }).url = "https://gateway.example.test";
			(config.burrowgate as { url: string; token: string; siteId: string }).token = "read-only-token";
			(config.burrowgate as { url: string; token: string; siteId: string }).siteId = "main-site-id";
			globalThis.fetch = (async (input, init) => {
				const url = new URL(String(input));
				requests.push(url);
				expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer read-only-token");
				const path = url.searchParams.get("path");
				return Response.json({
					view: url.searchParams.get("view"),
					metric: url.searchParams.get("metric"),
					path,
					pathPrefix: null,
					successfulOnly: true,
					title: "Traffic",
					unit: "requests",
					hours: 24,
					from: "2026-09-13T00:00:00.000Z",
					to: "2026-09-14T00:00:00.000Z",
					bucketSeconds: 3600,
					hasData: true,
					maximum: 4,
					stats: [],
					rows:
						path === null
							? [
									{ label: "/", value: 4 },
									{ label: `/media/avatars/${USER}`, value: 12 },
									{ label: `/media/images/${USER}/${PICTURE}`, value: 8 },
									{ label: "/assets/blog-example.css", value: 5 },
									{ label: "/robots.txt", value: 2 },
									{ label: "/first-story", value: 3 },
								]
							: [],
					points: [],
				});
			}) as typeof fetch;

			const generated = await createSession(USER);
			const app = createApp();
			const paths = await app.handle(
				new Request("http://localhost:3000/api/v1/analytics?view=paths&hours=24&metric=requests", {
					headers: { Authorization: `Bearer ${generated.token}` },
				}),
			);
			const pathsBody = (await paths.json()) as { data: { rows: { label: string; value: number; detail?: string }[] } };
			expect(paths.status).toBe(200);
			expect(pathsBody.data.rows).toEqual([
				{ label: "Blog home", detail: "/", value: 4 },
				{ label: "The first Rabbit Company story", detail: "/first-story", value: 3 },
			]);

			const page = await app.handle(
				new Request("http://localhost:3000/api/v1/analytics?view=overview&hours=24&metric=requests&page=first-story", {
					headers: { Authorization: `Bearer ${generated.token}` },
				}),
			);
			expect(page.status).toBe(200);
			expect(requests).toHaveLength(2);
			expect(requests[0]!.searchParams.get("siteId")).toBe("custom-site-id");
			expect(requests[0]!.searchParams.has("pathPrefix")).toBe(false);
			expect(requests[0]!.searchParams.has("path")).toBe(false);
			expect(requests[1]!.searchParams.get("siteId")).toBe("custom-site-id");
			expect(requests[1]!.searchParams.get("path")).toBe("/first-story");
		} finally {
			globalThis.fetch = originalFetch;
			(config.burrowgate as { url: string; token: string; siteId: string }).url = originalUrl;
			(config.burrowgate as { url: string; token: string; siteId: string }).token = originalToken;
			(config.burrowgate as { url: string; token: string; siteId: string }).siteId = originalSiteId;
		}
	});

	test("stops resolving immediately when the custom-domain license is revoked", async () => {
		const license = await activateDomain();
		expect((await createApp().handle(new Request(`https://${HOSTNAME}/`))).status).toBe(200);
		await revokeLicense(license.id);
		const response = await createApp().handle(new Request(`https://${HOSTNAME}/`));
		const originalPage = await createApp().handle(new Request(`http://localhost:3000/creator/${USER}`));
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not found");
		expect(originalPage.status).toBe(200);
	});

	test("rejects unknown hostnames instead of showing the Bloggy homepage", async () => {
		const response = await createApp().handle(new Request("https://unclaimed.example.test/"));
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not found");
	});

	test("lets an entitled owner connect and remove a manually provisioned domain", async () => {
		customDomainConfig("manual", "customers.bloggy.test");
		const generated = await createLicenses({ count: 1, durationDays: 30, storageBytes: 0, customDomain: true, createdBy: "test-admin" });
		await redeemLicense(generated.keys[0]!, USER);
		const session = await createSession(USER);
		const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };

		const connected = await createApp().handle(
			new Request("http://localhost:3000/api/v1/custom-domain", {
				method: "POST",
				headers,
				body: JSON.stringify({ hostname: HOSTNAME }),
			}),
		);
		const connectedBody = (await connected.json()) as {
			data: {
				cnameTarget: string;
				domain: { status: string; hostname: string; verificationRecords: { type: string; name: string; value: string }[] };
			};
		};
		expect(connected.status).toBe(200);
		expect(connectedBody.data.cnameTarget).toBe("customers.bloggy.test");
		expect(connectedBody.data.domain).toMatchObject({ status: "pending", hostname: HOSTNAME });
		expect(connectedBody.data.domain.verificationRecords).toEqual([{ type: "TXT", name: `_bloggy-verify.${HOSTNAME}`, value: expect.any(String) }]);

		const removed = await createApp().handle(
			new Request("http://localhost:3000/api/v1/custom-domain", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } }),
		);
		expect(removed.status).toBe(200);
		expect(await sql`SELECT id FROM custom_domains WHERE username = ${USER}`).toHaveLength(0);
	});
});
