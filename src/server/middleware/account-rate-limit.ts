import { rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { ErrorCode, errorMessage } from "../lib/errors.ts";
import type { AppMiddleware, AppState } from "../types.ts";

export interface AccountRateLimitPolicy {
	windowMs: number;
	max: number;
}

/** Limits for authenticated owners and team members. */
export const ACCOUNT_RATE_LIMITS = {
	read: { windowMs: 60_000, max: 180 },
	write: { windowMs: 5 * 60_000, max: 60 },
	preview: { windowMs: 60_000, max: 120 },
	upload: { windowMs: 10 * 60_000, max: 60 },
	analytics: { windowMs: 5 * 60_000, max: 60 },
	security: { windowMs: 60 * 60_000, max: 10 },
	critical: { windowMs: 60 * 60_000, max: 3 },
} as const satisfies Record<string, AccountRateLimitPolicy>;

/** Limits for endpoints that must work before a user is authenticated. */
export const ANONYMOUS_ACTION_RATE_LIMITS = {
	register: { windowMs: 60 * 60_000, max: 5 },
	credential: { windowMs: 15 * 60_000, max: 10 },
	email: { windowMs: 15 * 60_000, max: 5 },
	token: { windowMs: 15 * 60_000, max: 30 },
	invitation: { windowMs: 15 * 60_000, max: 10 },
} as const satisfies Record<string, AccountRateLimitPolicy>;

export type AccountRateLimitProfile = keyof typeof ACCOUNT_RATE_LIMITS;
export type AnonymousActionRateLimitProfile = keyof typeof ANONYMOUS_ACTION_RATE_LIMITS;

/**
 * Limits one authenticated endpoint by the acting identity. Team members use
 * their own username instead of sharing the blog owner's allowance.
 */
export function accountRateLimit(route: string, profile: AccountRateLimitProfile): AppMiddleware {
	const policy = ACCOUNT_RATE_LIMITS[profile];

	return rateLimit<AppState>({
		...policy,
		message: errorMessage(ErrorCode.RATE_LIMITED),
		statusCode: 429,
		keyGenerator: (ctx) => {
			const actor = ctx.get("actor");
			const creator = ctx.get("creator");
			return `account:${actor?.username ?? creator?.username ?? ctx.clientIp ?? "unknown"}`;
		},
		endpointGenerator: () => route,
	});
}

/** Limits one unauthenticated action by client IP. */
export function anonymousActionRateLimit(route: string, profile: AnonymousActionRateLimitProfile): AppMiddleware {
	const policy = ANONYMOUS_ACTION_RATE_LIMITS[profile];

	return rateLimit<AppState>({
		...policy,
		message: errorMessage(ErrorCode.RATE_LIMITED),
		statusCode: 429,
		endpointGenerator: () => route,
	});
}
