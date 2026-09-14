import { rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { ErrorCode, errorMessage } from "../lib/errors.ts";
import type { AppMiddleware, AppState } from "../types.ts";

export interface AdminRateLimitPolicy {
	windowMs: number;
	max: number;
}

/**
 * Limits are intentionally stricter as the cost or impact of an operation
 * rises. Read limits still leave enough room for filtering and pagination in
 * the panel, while destructive and server-wide jobs allow only small bursts.
 */
export const ADMIN_RATE_LIMITS = {
	read: { windowMs: 60_000, max: 120 },
	write: { windowMs: 5 * 60_000, max: 30 },
	sensitive: { windowMs: 60 * 60_000, max: 10 },
	expensive: { windowMs: 60 * 60_000, max: 3 },
	critical: { windowMs: 60 * 60_000, max: 2 },
} as const satisfies Record<string, AdminRateLimitPolicy>;

export const ADMIN_API_IP_RATE_LIMIT = { windowMs: 60_000, max: 180 } as const satisfies AdminRateLimitPolicy;

export type AdminRateLimitProfile = keyof typeof ADMIN_RATE_LIMITS;

/** Limits all admin API traffic from one IP before authentication. */
export function adminApiIpRateLimit(): AppMiddleware {
	return rateLimit<AppState>({
		...ADMIN_API_IP_RATE_LIMIT,
		message: errorMessage(ErrorCode.RATE_LIMITED),
		statusCode: 429,
		endpointGenerator: () => "admin-api",
	});
}

/**
 * Creates an independent limiter for one admin route.
 *
 * Browser requests are grouped by the authenticated admin account. Operator
 * routes use one shared key because the deployment has one shared admin token.
 * This prevents rotating IP addresses from multiplying an authenticated
 * caller's allowance. Invalid credentials are still covered by the global
 * per-IP API limiter before authentication is attempted.
 */
export function adminRateLimit(route: string, profile: AdminRateLimitProfile): AppMiddleware {
	const policy = ADMIN_RATE_LIMITS[profile];

	return rateLimit<AppState>({
		windowMs: policy.windowMs,
		max: policy.max,
		message: errorMessage(ErrorCode.RATE_LIMITED),
		statusCode: 429,
		keyGenerator: (ctx) => {
			const creator = ctx.get("creator");
			return creator?.username ? `admin:${creator.username}` : "operator";
		},
		endpointGenerator: () => route,
	});
}
