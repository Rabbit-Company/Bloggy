import { config } from "../config.ts";
import { cacheEvents, httpDuration, httpRequests } from "../lib/metrics.ts";
import type { AppMiddleware } from "../types.ts";

/**
 * Recording raw paths would create one time series per username and per post
 * slug, which is exactly the cardinality explosion that makes a metrics
 * backend fall over. Dynamic segments become placeholders instead.
 */
export function routeLabel(pathname: string): string {
	const segments = pathname.split("/").filter((s) => s.length > 0);
	if (segments.length === 0) return "/";

	if (segments[0] === "creator") {
		if (segments.length === 1) return "/creator";
		if (segments.length === 2) return "/creator/:username";
		const last = segments[2] ?? "";
		if (last.startsWith("feed.")) return `/creator/:username/${last}`;
		return "/creator/:username/:slug";
	}

	if (segments[0] === "media") {
		return segments[1] === "avatars" ? "/media/avatars/:username" : "/media/images/:username/:id";
	}

	if (segments[0] === "api") {
		return `/${segments.map((segment) => (/^[0-9a-f]{8}-|^[a-z][a-z0-9-]{3,}$/i.test(segment) && !isApiKeyword(segment) ? ":id" : segment)).join("/")}`;
	}

	return `/${segments.join("/")}`;
}

const API_KEYWORDS = new Set([
	"api",
	"v1",
	"auth",
	"creators",
	"posts",
	"media",
	"me",
	"settings",
	"social",
	"avatar",
	"sessions",
	"password",
	"login",
	"logout",
	"register",
	"analytics",
	"backup-codes",
	"confirm",
	"begin",
	"disable",
	"admin",
	"cache",
	"stats",
]);

function isApiKeyword(segment: string): boolean {
	return API_KEYWORDS.has(segment) || segment === "2fa";
}

/**
 * Runs outermost so the timing covers all downstream middleware, including the
 * cache lookup that may short-circuit the handler.
 */
export function metrics(): AppMiddleware {
	return async (ctx, next) => {
		if (!config.metrics.enabled) {
			await next();
			return;
		}

		const started = performance.now();
		const method = ctx.req.method;
		const route = routeLabel(new URL(ctx.req.url).pathname);

		const response = await next();
		const seconds = (performance.now() - started) / 1000;

		const status = response instanceof Response ? response.status : 200;
		httpRequests.inc(1, { method, route, status: String(status) });
		httpDuration.observe(seconds, { method, route });

		if (response instanceof Response) {
			const cacheHeader = response.headers.get("X-Cache");
			if (cacheHeader !== null) {
				cacheEvents.inc(1, { result: cacheHeader.toLowerCase() });
			}
		}

		return response ?? undefined;
	};
}
