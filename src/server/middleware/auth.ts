import { ApiError, ErrorCode } from "../lib/errors.ts";
import { findCreator, isAdmin, isSuspended, type CreatorRow } from "../db/creators.ts";
import { resolveSession } from "../auth/sessions.ts";
import { config } from "../config.ts";
import { safeEqual } from "../lib/crypto.ts";
import { SESSION_COOKIE, readCookie } from "../lib/cookies.ts";
import type { AppContext, AppMiddleware } from "../types.ts";

/**
 * The scheme is compared case-insensitively, as RFC 7235 requires.
 */
function bearerToken(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (header === null) return null;

	const space = header.indexOf(" ");
	if (space === -1) return null;
	if (header.slice(0, space).toLowerCase() !== "bearer") return null;

	const token = header.slice(space + 1).trim();
	return token.length === 0 ? null : token;
}

export type AuthSource = "cookie" | "bearer";

export function credentials(req: Request): { token: string; source: AuthSource } | null {
	const bearer = bearerToken(req);
	if (bearer !== null) return { token: bearer, source: "bearer" };

	const cookie = readCookie(req, SESSION_COOKIE);
	if (cookie !== null && cookie.length > 0) return { token: cookie, source: "cookie" };

	return null;
}

/**
 * Resolves an active creator when a public page wants to adapt its navigation
 * without turning an absent or stale session into an authentication error.
 */
export async function findSignedInCreator(req: Request): Promise<CreatorRow | null> {
	const found = credentials(req);
	if (found === null) return null;

	const session = await resolveSession(found.token);
	if (session === null) return null;

	const creator = await findCreator(session.username);
	if (creator === null || isSuspended(creator)) return null;
	return creator;
}

export function requireAuth(): AppMiddleware {
	return async (ctx, next) => {
		const found = credentials(ctx.req);
		if (found === null) throw new ApiError(ErrorCode.INVALID_TOKEN);

		const session = await resolveSession(found.token);
		if (session === null) throw new ApiError(ErrorCode.INVALID_TOKEN);

		const creator = await findCreator(session.username);
		if (creator === null) throw new ApiError(ErrorCode.INVALID_TOKEN);

		// Suspending revokes the account's sessions, so this only catches one
		// issued in the same instant. Checked anyway: a suspension that depends
		// on the revocation having landed is not a suspension.
		if (isSuspended(creator)) throw new ApiError(ErrorCode.ACCOUNT_SUSPENDED);

		ctx.set("session", session);
		ctx.set("creator", creator);
		ctx.set("token", found.token);
		ctx.set("authSource", found.source);

		return await next();
	};
}

/**
 * Bearer only: the admin token is for scripts and scrapers, and accepting it
 * from a cookie would put ordinary browser sessions one step from it.
 *
 * Refuses every request when ADMIN_TOKEN is unset, so an unconfigured
 * deployment fails closed instead of exposing maintenance endpoints.
 */
export function requireAdmin(): AppMiddleware {
	return async (ctx, next) => {
		const token = bearerToken(ctx.req);
		if (token === null) throw new ApiError(ErrorCode.UNAUTHORIZED);
		if (config.secrets.adminToken.length === 0) throw new ApiError(ErrorCode.UNAUTHORIZED);
		if (!safeEqual(token, config.secrets.adminToken)) throw new ApiError(ErrorCode.UNAUTHORIZED);

		return await next();
	};
}

/**
 * Requires a signed-in creator whose account carries the admin flag.
 *
 * Separate from {@link requireAdmin}, which authenticates the *operator* by
 * shared token for scripts and scrapers. Moderation is done by a person in a
 * browser, so it rides on the ordinary session cookie and inherits password
 * checks, 2FA and the CSRF guard rather than putting a shared secret in a page.
 */
export function requireAdminAccount(): AppMiddleware {
	const auth = requireAuth();
	return async (ctx, next) => {
		return await auth(ctx, async () => {
			if (!isAdmin(ctx.get("creator"))) throw new ApiError(ErrorCode.NOT_ADMIN);
			return await next();
		});
	};
}

export function assertOwner(ctx: AppContext, username: string): void {
	if (ctx.get("creator")?.username !== username) {
		throw new ApiError(ErrorCode.UNAUTHORIZED);
	}
}
