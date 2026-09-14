import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { config } from "../src/server/config.ts";
import { createSession } from "../src/server/auth/sessions.ts";
import { insertCreator, setAdmin } from "../src/server/db/creators.ts";
import {
	createLicenses,
	countLicenses,
	generateLicenseKey,
	isLicenseKeyValid,
	licenseEntitlements,
	listLicenses,
	normalizeLicenseKey,
	redeemLicense,
	revokeLicense,
} from "../src/server/db/licenses.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { storageQuota } from "../src/server/lib/quota.ts";
import { createApp } from "../src/server/index.ts";

const USER = "license-test-user";
const OWNER = "license-owner";
const ADMIN = "license-admin";
const BASE_LIMIT = 100 * 1024 ** 2;
const MB = 1024 ** 2;
const originalLimit = config.limits.maxAccountStorage;

function setLimit(bytes: number): void {
	(config.limits as { maxAccountStorage: number }).maxAccountStorage = bytes;
}

async function generate(storageBytes: number, customDomain: boolean, durationDays: number) {
	const result = await createLicenses({ count: 1, storageBytes, customDomain, durationDays, createdBy: "test-admin" });
	return { key: result.keys[0] as string, license: result.licenses[0]! };
}

function account(username: string) {
	return {
		username,
		password: "unused",
		email: `${username}@example.com`,
		title: `${username} blog`,
		description: "A blog description long enough to satisfy the validation rules.",
		author: `${username} person`,
		category: "Business",
		language: "en",
		theme: "light",
	};
}

async function apiCall(path: string, token: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	if (typeof init.body === "string") headers.set("Content-Type", "application/json");
	return await createApp().handle(new Request(`http://localhost:3000${path}`, { ...init, headers }));
}

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	await sql`DELETE FROM licenses`;
	await sql`DELETE FROM media WHERE username = ${USER}`;
	await sql`DELETE FROM sessions WHERE username IN (${OWNER}, ${ADMIN})`;
	await sql`DELETE FROM creators WHERE username IN (${OWNER}, ${ADMIN})`;
	await insertCreator(account(OWNER));
	await insertCreator(account(ADMIN));
	await setAdmin(ADMIN, true);
	setLimit(BASE_LIMIT);
});

afterAll(() => setLimit(originalLimit));

describe("license keys", () => {
	test("are random, normalized and only retained as safe hints", async () => {
		const first = generateLicenseKey();
		const second = generateLicenseKey();
		expect(first).not.toBe(second);
		expect(isLicenseKeyValid(first)).toBe(true);
		expect(normalizeLicenseKey(`  ${first.toLowerCase()}  `)).toBe(first);

		const created = await createLicenses({ count: 2, durationDays: 30, storageBytes: 5 * MB, customDomain: true, createdBy: "admin" });
		expect(created.keys).toHaveLength(2);
		expect((await listLicenses()).every((license) => license.keyHint.startsWith("BLOGGY-...-") && !created.keys.includes(license.keyHint))).toBe(true);
	});

	test("can only be redeemed once", async () => {
		const { key } = await generate(5 * MB, true, 30);
		expect((await redeemLicense(key.toLowerCase(), USER)).status).toBe("redeemed");
		expect((await redeemLicense(key, "somebody-else")).status).toBe("used");
	});

	test("starts its duration when redeemed", async () => {
		const { key } = await generate(5 * MB, true, 30);
		const start = "2026-01-10T12:00:00.000Z";
		const result = await redeemLicense(key, USER, start);
		expect(result.status).toBe("redeemed");
		if (result.status === "redeemed") expect(result.license.expiresAt).toBe("2026-02-09T12:00:00.000Z");
	});

	test("searches by full key, key suffix and redeemed username", async () => {
		const created = await createLicenses({ count: 3, durationDays: 30, storageBytes: MB, customDomain: false, createdBy: ADMIN });
		await redeemLicense(created.keys[1]!, OWNER);
		const target = created.licenses[1]!;
		expect((await listLicenses(25, 0, created.keys[1]!)).map((license) => license.id)).toEqual([target.id]);
		expect((await listLicenses(25, 0, created.keys[1]!.slice(-8))).map((license) => license.id)).toEqual([target.id]);
		expect((await listLicenses(25, 0, "LICENSE-OWN")).map((license) => license.id)).toEqual([target.id]);
		expect(await countLicenses("license-own")).toBe(1);
	});

	test("paginates without repeating licenses", async () => {
		await createLicenses({ count: 30, durationDays: 30, storageBytes: MB, customDomain: false, createdBy: ADMIN });
		const first = await listLicenses(25, 0);
		const second = await listLicenses(25, 25);
		expect(first).toHaveLength(25);
		expect(second).toHaveLength(5);
		expect(new Set([...first, ...second].map((license) => license.id)).size).toBe(30);
	});
});

describe("stacked entitlements", () => {
	test("sums storage while each key independently controls its benefits", async () => {
		const first = await generate(5 * MB, true, 30);
		const second = await generate(10 * MB, false, 90);
		const start = "2026-01-01T00:00:00.000Z";
		await redeemLicense(first.key, USER, start);
		await redeemLicense(second.key, USER, start);

		expect(await licenseEntitlements(USER, "2026-01-20T00:00:00.000Z")).toMatchObject({
			additionalStorage: 15 * MB,
			customDomain: true,
		});
		expect(await licenseEntitlements(USER, "2026-02-15T00:00:00.000Z")).toMatchObject({
			additionalStorage: 10 * MB,
			customDomain: false,
		});
		expect(await licenseEntitlements(USER, "2026-04-15T00:00:00.000Z")).toMatchObject({
			additionalStorage: 0,
			customDomain: false,
		});
	});

	test("adds active storage to the configured account allowance", async () => {
		const { key } = await generate(5 * MB, false, 30);
		await redeemLicense(key, USER);
		expect(await storageQuota(USER)).toEqual({ used: 0, limit: BASE_LIMIT + 5 * MB });
	});

	test("does not turn an unlimited instance into a limited one", async () => {
		const { key } = await generate(5 * MB, false, 30);
		await redeemLicense(key, USER);
		setLimit(0);
		expect(await storageQuota(USER)).toEqual({ used: 0, limit: 0 });
	});

	test("revocation immediately removes every benefit", async () => {
		const { key, license } = await generate(5 * MB, true, 30);
		await redeemLicense(key, USER);
		expect((await licenseEntitlements(USER)).customDomain).toBe(true);
		expect(await revokeLicense(license.id)).toBe(1);
		expect(await licenseEntitlements(USER)).toMatchObject({ additionalStorage: 0, customDomain: false });
		expect(await revokeLicense(license.id)).toBe(0);
	});
});

describe("license API", () => {
	test("restricts generation to administrators and never lists full keys", async () => {
		const ownerSession = await createSession(OWNER);
		const denied = await apiCall("/api/v1/admin/licenses", ownerSession.token);
		expect(denied.status).toBe(403);

		const adminSession = await createSession(ADMIN);
		const response = await apiCall("/api/v1/admin/licenses", adminSession.token, {
			method: "POST",
			body: JSON.stringify({ count: 2, durationDays: 90, storageBytes: 10 * MB, customDomain: false }),
		});
		expect(response.status).toBe(201);
		const generated = (await response.json()) as { data: { keys: string[] } };
		expect(generated.data.keys).toHaveLength(2);

		const listing = await apiCall("/api/v1/admin/licenses", adminSession.token);
		const listingText = await listing.text();
		expect(listing.status).toBe(200);
		for (const key of generated.data.keys) expect(listingText).not.toContain(key);

		const searched = await apiCall("/api/v1/admin/licenses/query", adminSession.token, {
			method: "POST",
			body: JSON.stringify({ limit: 25, offset: 0, search: generated.data.keys[0] }),
		});
		const searchedBody = (await searched.json()) as { data: { total: number; licenses: { id: string }[] } };
		expect(searchedBody.data.total).toBe(1);
		expect(searchedBody.data.licenses).toHaveLength(1);
	});

	test("lets an owner redeem a key and returns the stacked account allowance", async () => {
		const { key } = await generate(5 * MB, true, 30);
		const ownerSession = await createSession(OWNER);
		const redeemed = await apiCall("/api/v1/licenses/redeem", ownerSession.token, {
			method: "POST",
			body: JSON.stringify({ key }),
		});
		expect(redeemed.status).toBe(200);
		const body = (await redeemed.json()) as { data: { entitlements: { additionalStorage: number; limit: number; customDomain: boolean } } };
		expect(body.data.entitlements).toMatchObject({
			additionalStorage: 5 * MB,
			limit: BASE_LIMIT + 5 * MB,
			customDomain: true,
		});

		const adminSession = await createSession(ADMIN);
		const overview = await apiCall(`/api/v1/admin/creators?q=${OWNER}`, adminSession.token);
		const overviewBody = (await overview.json()) as {
			data: { total: number; creators: { username: string; storageLimit: number; activeLicenses: number; licensesUsed: number; customDomain: boolean }[] };
		};
		expect(overviewBody.data.total).toBe(1);
		expect(overviewBody.data.creators[0]).toMatchObject({
			username: OWNER,
			storageLimit: BASE_LIMIT + 5 * MB,
			activeLicenses: 1,
			licensesUsed: 1,
			customDomain: true,
		});

		const repeated = await apiCall("/api/v1/licenses/redeem", ownerSession.token, {
			method: "POST",
			body: JSON.stringify({ key }),
		});
		expect(repeated.status).toBe(409);
	});
});
