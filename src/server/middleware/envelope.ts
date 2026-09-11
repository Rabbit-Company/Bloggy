import { ErrorCode, errorMessage } from "../lib/errors.ts";
import type { AppMiddleware } from "../types.ts";

/**
 * Every Bloggy endpoint answers with `{ error: <numeric code>, info: "..." }`,
 * and the panel branches on that number. The rate-limit middleware instead
 * answers with `{ error: "<message>" }`, a string where a code belongs, and
 * no `info` at all, which would surface in the panel as "undefined".
 *
 * The middleware exposes no way to change its response shape, so the response
 * is normalized on the way out instead. Only bodies that do not already carry
 * a numeric `error` are touched, so genuine API responses pass through
 * untouched. Headers are preserved, which matters because the rate limiter
 * puts the useful part (`RateLimit-Reset` and friends) there.
 */
export function normalizeErrorEnvelope(): AppMiddleware {
	return async (ctx, next) => {
		const response = await next();
		if (!(response instanceof Response)) return response;

		if (response.status < 400) return response;
		if (!(response.headers.get("Content-Type") ?? "").includes("application/json")) return response;

		let body: Record<string, unknown>;
		try {
			body = (await response.clone().json()) as Record<string, unknown>;
		} catch {
			return response;
		}

		if (typeof body.error === "number") return response;

		const code = response.status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.INTERNAL_ERROR;
		const info = typeof body.error === "string" ? body.error : typeof body.info === "string" ? body.info : errorMessage(code);

		const { error: _discarded, ...rest } = body;

		return new Response(JSON.stringify({ error: code, info, ...rest }), {
			status: response.status,
			headers: response.headers,
		});
	};
}
