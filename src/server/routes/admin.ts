import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { ok } from "../lib/response.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { pageCache, purgeCache } from "../middleware/cache.ts";
import { METRICS_CONTENT_TYPE, cacheEntries, creatorsTotal, metricsText, postsTotal, sessionsActive } from "../lib/metrics.ts";
import { countCreators } from "../db/creators.ts";
import { countPosts } from "../db/posts.ts";
import { countSessions, pruneExpiredSessions } from "../db/sessions.ts";
import type { AppState } from "../types.ts";

export async function refreshGauges(): Promise<void> {
	const [creators, posts, sessions, entries] = await Promise.all([countCreators(), countPosts(), countSessions(), pageCache.size()]);

	creatorsTotal.set(creators);
	postsTotal.set(posts);
	sessionsActive.set(sessions);
	cacheEntries.set(entries);
}

export function adminRoutes(app: Web<AppState>): void {
	if (config.metrics.enabled) {
		const guards = config.secrets.adminToken.length > 0 ? [requireAdmin()] : [];

		app.get("/metrics", ...guards, async (ctx) => {
			await refreshGauges();
			return new Response(metricsText(), {
				headers: { "Content-Type": METRICS_CONTENT_TYPE, "Cache-Control": "no-store" },
			});
		});
	}

	app.post("/api/v1/admin/cache/purge", requireAdmin(), async (ctx) => {
		await purgeCache();
		return ok(ctx);
	});

	app.get("/api/v1/admin/stats", requireAdmin(), async (ctx) => {
		const [creators, posts, sessions, entries] = await Promise.all([countCreators(), countPosts(), countSessions(), pageCache.size()]);

		return ok(ctx, {
			creators,
			posts,
			sessions,
			cacheEntries: entries,
			database: config.database.dialect,
			storage: config.storage.driver,
			uptime: Math.round(process.uptime()),
		});
	});

	app.post("/api/v1/admin/sessions/prune", requireAdmin(), async (ctx) => {
		await pruneExpiredSessions();
		return ok(ctx);
	});
}
