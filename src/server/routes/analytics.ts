import { Web } from "@rabbit-company/web";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { ok } from "../lib/response.ts";
import { requireOwner } from "../middleware/auth.ts";
import {
	ANALYTICS_HOURS,
	ANALYTICS_METRICS,
	ANALYTICS_VIEWS,
	BurrowGateError,
	analyticsEnabled,
	fetchAnalytics,
	type AnalyticsHours,
	type AnalyticsMetric,
	type AnalyticsView,
} from "../lib/burrowgate.ts";
import { listPostsByCreator } from "../db/posts.ts";
import { findActiveCustomDomainByUsername } from "../db/custom-domains.ts";
import type { AppState } from "../types.ts";
import { accountRateLimit } from "../middleware/account-rate-limit.ts";
import { isSlugValid } from "../lib/validation.ts";

async function describePaths(username: string, rows: { label: string; value: number; detail?: string }[], base = `/creator/${username}`) {
	const titles = new Map((await listPostsByCreator(username)).map((post) => [post.slug, post.title]));
	const home = base || "/";

	return rows.flatMap((row) => {
		if (row.label === home || (base.length > 0 && row.label === `${base}/`)) return { ...row, label: "Blog home", detail: home };

		const rest =
			base.length === 0 ? (row.label.startsWith("/") ? row.label.slice(1) : null) : row.label.startsWith(`${base}/`) ? row.label.slice(base.length + 1) : null;
		if (rest === null) return row;

		if (rest.startsWith("feed.")) return { ...row, label: `${rest.slice(5).toUpperCase()} feed`, detail: row.label };
		if (base.length === 0 && !isSlugValid(rest)) return [];

		const title = titles.get(rest);
		return title === undefined ? { ...row, label: rest, detail: "No longer published" } : { ...row, label: title, detail: `/${rest}` };
	});
}

export function analyticsRoutes(app: Web<AppState>): void {
	if (!analyticsEnabled()) return;

	app.get("/api/v1/analytics", requireOwner(), accountRateLimit("analytics.read", "analytics"), async (ctx) => {
		const query = ctx.query();
		const view = query.get("view") ?? "overview";
		const hours = Number.parseInt(query.get("hours") ?? "168", 10);
		const metric = query.get("metric") ?? "requests";

		if (!(ANALYTICS_VIEWS as readonly string[]).includes(view)) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, `Unknown view. Available: ${ANALYTICS_VIEWS.join(", ")}`);
		}
		if (!(ANALYTICS_HOURS as readonly number[]).includes(hours)) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, `Hours must be one of ${ANALYTICS_HOURS.join(", ")}`);
		}
		if (!(ANALYTICS_METRICS as readonly string[]).includes(metric)) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, `Metric must be one of ${ANALYTICS_METRICS.join(", ")}`);
		}

		const username = ctx.get("creator").username;
		const customDomain = await findActiveCustomDomainByUsername(username);
		if (customDomain && !customDomain.gatewaySiteId) {
			throw new ApiError(ErrorCode.INTERNAL_ERROR, "Analytics is unavailable because this custom domain has no BurrowGate site identifier.");
		}
		const analyticsScope = customDomain?.gatewaySiteId ? { siteId: customDomain.gatewaySiteId, basePath: "" } : undefined;

		const page = query.get("page");
		let slug: string | undefined;
		if (page !== null) {
			if (page === "home") slug = "";
			else if ((await listPostsByCreator(username)).some((post) => post.slug === page)) slug = page;
			else throw new ApiError(ErrorCode.POST_NOT_FOUND, "That page is not one of yours.");
		}

		try {
			const data = await fetchAnalytics(view as AnalyticsView, hours as AnalyticsHours, username, slug, metric as AnalyticsMetric, analyticsScope);
			if (view === "paths") data.rows = await describePaths(username, data.rows, analyticsScope?.basePath);
			return ok(ctx, data);
		} catch (err) {
			if (err instanceof BurrowGateError) throw new ApiError(ErrorCode.INTERNAL_ERROR, err.message);
			throw err;
		}
	});

	app.get("/api/v1/analytics/pages", requireOwner(), accountRateLimit("analytics.pages", "read"), async (ctx) => {
		const username = ctx.get("creator").username;
		const posts = await listPostsByCreator(username);

		return ok(ctx, {
			pages: [
				{ value: "home", label: "Blog home" },
				...posts.filter((post) => post.status === "published").map((post) => ({ value: post.slug, label: post.title })),
			],
		});
	});
}
