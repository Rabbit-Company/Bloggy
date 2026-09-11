import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { SESSION_COOKIE, readCookie } from "../lib/cookies.ts";
import type { AppMiddleware } from "../types.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `SameSite=Lax` already stops the browser attaching the cookie to a
 * cross-site POST, which covers current browsers. This is the second layer,
 * for the cases that rule does not: it requires a state-changing request that
 * carries the session cookie to also declare an `Origin` this instance owns.
 *
 * Requests authenticated with a bearer token are exempt, because an attacker's
 * page cannot set an `Authorization` header on a cross-origin request without
 * the CORS preflight succeeding first. Requests with no session cookie are
 * exempt for the same reason there is nothing to forge. Login and
 * registration are protected by rate limiting, not by this.
 */
export function csrfGuard(): AppMiddleware {
	const configured = new Set<string>([config.server.domain, ...config.server.apiOrigins]);
	const allowAny = config.server.apiOrigins.includes("*");

	const hostOf = (value: string): string | null => {
		try {
			return new URL(value).host;
		} catch {
			return null;
		}
	};

	const configuredHosts = new Set([...configured].map(hostOf).filter((host): host is string => host !== null));

	return async (ctx, next) => {
		if (SAFE_METHODS.has(ctx.req.method)) return await next();

		if (ctx.req.headers.get("Authorization") !== null) return await next();
		if (readCookie(ctx.req, SESSION_COOKIE) === null) return await next();

		const origin = ctx.req.headers.get("Origin");

		if (origin === null) {
			const site = ctx.req.headers.get("Sec-Fetch-Site");
			if (site !== null && site !== "same-origin" && site !== "none") {
				throw new ApiError(ErrorCode.CSRF_REJECTED);
			}
			return await next();
		}

		if (allowAny) return await next();

		const originHost = hostOf(origin);
		if (originHost === null) throw new ApiError(ErrorCode.CSRF_REJECTED);

		// The real test is whether the request came from this very site, so the
		// Origin is compared against the host the request arrived on rather than
		// against a configured string. Matching DOMAIN literally is too brittle:
		// a missing port, a www mismatch, or TLS terminated by a proxy would all
		// reject every write from the panel with a misleading error.
		//
		// Host is not attacker-controlled here, since a browser sets it from the URL
		// and will not let a page forge it, and the session cookie only travels
		// to its own domain, so a cross-site page always fails this comparison.
		if (originHost === hostOf(ctx.req.url)) return await next();
		if (configuredHosts.has(originHost)) return await next();

		throw new ApiError(ErrorCode.CSRF_REJECTED);
	};
}
