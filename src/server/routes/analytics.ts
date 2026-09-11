import { Web } from "@rabbit-company/web";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { ok } from "../lib/response.ts";
import { requireAuth } from "../middleware/auth.ts";
import {
	ANALYTICS_HOURS,
	ANALYTICS_VIEWS,
	BurrowGateError,
	analyticsEnabled,
	fetchAnalytics,
	type AnalyticsHours,
	type AnalyticsView,
} from "../lib/burrowgate.ts";
import { listPostsByCreator } from "../db/posts.ts";
import type { AppState } from "../types.ts";

async function describePaths(username: string, rows: { label: string; value: number; detail?: string }[]) {
	const titles = new Map((await listPostsByCreator(username)).map((post) => [post.slug, post.title]));
	const base = `/creator/${username}`;

	return rows.map((row) => {
		if (row.label === base || row.label === `${base}/`) return { ...row, label: "Blog home", detail: base };

		const rest = row.label.startsWith(`${base}/`) ? row.label.slice(base.length + 1) : null;
		if (rest === null) return row;

		if (rest.startsWith("feed.")) return { ...row, label: `${rest.slice(5).toUpperCase()} feed`, detail: row.label };

		const title = titles.get(rest);
		return title === undefined ? { ...row, label: rest, detail: "No longer published" } : { ...row, label: title, detail: `/${rest}` };
	});
}

export function analyticsRoutes(app: Web<AppState>): void {
	if (!analyticsEnabled()) return;

	app.get("/api/v1/analytics", requireAuth(), async (ctx) => {
		const query = ctx.query();
		const view = query.get("view") ?? "overview";
		const hours = Number.parseInt(query.get("hours") ?? "168", 10);

		if (!(ANALYTICS_VIEWS as readonly string[]).includes(view)) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, `Unknown view. Available: ${ANALYTICS_VIEWS.join(", ")}`);
		}
		if (!(ANALYTICS_HOURS as readonly number[]).includes(hours)) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, `Hours must be one of ${ANALYTICS_HOURS.join(", ")}`);
		}

		const username = ctx.get("creator").username;

		const page = query.get("page");
		let slug: string | undefined;
		if (page !== null) {
			if (page === "home") slug = "";
			else if ((await listPostsByCreator(username)).some((post) => post.slug === page)) slug = page;
			else throw new ApiError(ErrorCode.POST_NOT_FOUND, "That page is not one of yours.");
		}

		try {
			const data = await fetchAnalytics(view as AnalyticsView, hours as AnalyticsHours, username, slug);
			if (view === "paths") data.rows = await describePaths(username, data.rows);
			return ok(ctx, data);
		} catch (err) {
			if (err instanceof BurrowGateError) throw new ApiError(ErrorCode.INTERNAL_ERROR, err.message);
			throw err;
		}
	});

	app.get("/api/v1/analytics/pages", requireAuth(), async (ctx) => {
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
