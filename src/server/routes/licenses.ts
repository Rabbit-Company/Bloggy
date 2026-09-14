import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { countLicenses, createLicenses, isLicenseKeyValid, licenseEntitlements, listLicenses, redeemLicense, revokeLicense } from "../db/licenses.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isUuidValid } from "../lib/validation.ts";
import { requireAdminAccount, requireOwner } from "../middleware/auth.ts";
import { adminRateLimit } from "../middleware/admin-rate-limit.ts";
import { accountRateLimit } from "../middleware/account-rate-limit.ts";
import type { AppContext, AppState } from "../types.ts";

const MAX_BATCH = 500;
const LICENSE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_DURATION_DAYS = 3650;
const MAX_STORAGE_BYTES = 10 * 1024 ** 4; // 10 TiB per license.

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new ApiError(ErrorCode.MISSING_FIELDS, `${label} must be a whole number from ${minimum} to ${maximum}.`);
	}
	return value;
}

function pageNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
	return Math.min(parsed, maximum);
}

async function licenseListResponse(ctx: AppContext, limit: number, offset: number, search: string): Promise<Response> {
	const [licenses, total] = await Promise.all([listLicenses(limit, offset, search), countLicenses(search)]);
	return ok(ctx, { licenses, total, limit, offset, search });
}

async function accountEntitlements(username: string) {
	const entitlements = await licenseEntitlements(username);
	const baseStorage = Math.max(0, config.limits.maxAccountStorage);
	return {
		baseStorage,
		additionalStorage: entitlements.additionalStorage,
		limit: config.limits.maxAccountStorage <= 0 ? 0 : Math.min(Number.MAX_SAFE_INTEGER, baseStorage + entitlements.additionalStorage),
		customDomain: entitlements.customDomain,
		licenses: entitlements.licenses,
	};
}

export function licenseRoutes(app: Web<AppState>): void {
	app.get("/api/v1/licenses", requireOwner(), accountRateLimit("licenses.read", "read"), async (ctx) => {
		return ok(ctx, await accountEntitlements(ctx.get("creator").username));
	});

	app.post("/api/v1/licenses/redeem", requireOwner(), accountRateLimit("licenses.redeem", "security"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["key"]);
		if (!isLicenseKeyValid(body.key)) throw new ApiError(ErrorCode.LICENSE_INVALID);

		const username = ctx.get("creator").username;
		const result = await redeemLicense(body.key, username);
		if (result.status !== "redeemed") throw new ApiError(ErrorCode.LICENSE_INVALID);

		logger.audit("License redeemed", { username, license: result.license.id, expiresAt: result.license.expiresAt });
		return ok(ctx, { license: result.license, entitlements: await accountEntitlements(username) });
	});

	app.get("/api/v1/admin/licenses", requireAdminAccount(), adminRateLimit("licenses.list", "read"), async (ctx) => {
		const params = new URL(ctx.req.url).searchParams;
		const limit = pageNumber(params.get("limit"), LICENSE_PAGE_SIZE, 1, MAX_PAGE_SIZE);
		const offset = pageNumber(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
		return await licenseListResponse(ctx, limit, offset, "");
	});

	// Search terms stay in the request body so a full, unused key cannot be
	// copied into access logs as part of a URL.
	app.post("/api/v1/admin/licenses/query", requireAdminAccount(), adminRateLimit("licenses.query", "read"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const limit = pageNumber(body.limit, LICENSE_PAGE_SIZE, 1, MAX_PAGE_SIZE);
		const offset = pageNumber(body.offset, 0, 0, Number.MAX_SAFE_INTEGER);
		const search = typeof body.search === "string" ? body.search.trim().slice(0, 100) : "";
		return await licenseListResponse(ctx, limit, offset, search);
	});

	app.post("/api/v1/admin/licenses", requireAdminAccount(), adminRateLimit("licenses.generate", "sensitive"), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["count", "durationDays", "storageBytes", "customDomain"]);

		const count = integer(body.count, 1, MAX_BATCH, "Count");
		const durationDays = integer(body.durationDays, 1, MAX_DURATION_DAYS, "Duration");
		const storageBytes = integer(body.storageBytes, 0, MAX_STORAGE_BYTES, "Storage allowance");
		if (typeof body.customDomain !== "boolean") {
			throw new ApiError(ErrorCode.MISSING_FIELDS, "Custom domain must be true or false.");
		}
		if (storageBytes === 0 && !body.customDomain) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, "A license must include storage, custom-domain access, or both.");
		}

		const createdBy = ctx.get("creator").username;
		const generated = await createLicenses({ count, durationDays, storageBytes, customDomain: body.customDomain, createdBy });
		logger.audit("Licenses generated", { by: createdBy, count, durationDays, storageBytes, customDomain: body.customDomain });
		return ok(ctx, generated, 201);
	});

	app.delete("/api/v1/admin/licenses/:id", requireAdminAccount(), adminRateLimit("licenses.revoke", "write"), async (ctx) => {
		const id = ctx.params.id ?? "";
		assertValid(id, isUuidValid, ErrorCode.NOT_FOUND);
		if ((await revokeLicense(id)) === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No active license with that ID.");
		logger.audit("License revoked", { by: ctx.get("creator").username, license: id });
		return ok(ctx);
	});
}
