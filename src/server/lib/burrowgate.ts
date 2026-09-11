import { config } from "../config.ts";
import { logger } from "./logger.ts";

export const ANALYTICS_VIEWS = ["overview", "paths", "geography", "referrers"] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

export const ANALYTICS_HOURS = [24, 168, 720] as const;

export type AnalyticsHours = (typeof ANALYTICS_HOURS)[number];

export interface AnalyticsResult {
	view: string;
	pathPrefix?: string | null;
	path?: string | null;
	successfulOnly?: boolean;
	title: string;
	unit: string;
	hours: number;
	from: string;
	to: string;
	bucketSeconds: number;
	hasData: boolean;
	maximum: number;
	stats: { label: string; value: number | null; unit: string }[];
	rows: { label: string; value: number; detail?: string }[];
	points: { timestamp: number; value: number | null; height: number }[];
}

export class BurrowGateError extends Error {}

export function analyticsEnabled(): boolean {
	const { url, token, siteId } = config.burrowgate;
	return url.length > 0 && token.length > 0 && siteId.length > 0;
}

export async function fetchAnalytics(view: AnalyticsView, hours: AnalyticsHours, username: string, slug?: string): Promise<AnalyticsResult> {
	if (!analyticsEnabled()) throw new BurrowGateError("Analytics is not configured on this instance.");

	const base = `/creator/${username}`;
	const exactPath = slug === undefined ? undefined : slug === "" ? base : `${base}/${slug}`;

	const url = new URL("/_burrowgate/api/v1/monitoring", config.burrowgate.url);
	url.searchParams.set("view", view);
	url.searchParams.set("hours", String(hours));
	url.searchParams.set("siteId", config.burrowgate.siteId);
	url.searchParams.set("successfulOnly", "true");
	if (exactPath === undefined) url.searchParams.set("pathPrefix", base);
	else url.searchParams.set("path", exactPath);

	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Authorization: `Bearer ${config.burrowgate.token}` },
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		logger.warn("BurrowGate request failed", { view, error: String(err) });
		throw new BurrowGateError("Could not reach the analytics gateway.");
	}

	if (response.status === 401 || response.status === 403) {
		logger.error("BurrowGate rejected the monitoring token", { status: response.status });
		throw new BurrowGateError("The analytics gateway rejected this instance's token.");
	}

	if (!response.ok) {
		logger.warn("BurrowGate returned an error", { view, status: response.status });
		throw new BurrowGateError("The analytics gateway returned an error.");
	}

	let result: AnalyticsResult;
	try {
		result = (await response.json()) as AnalyticsResult;
	} catch {
		throw new BurrowGateError("The analytics gateway returned an unreadable response.");
	}

	// Fail closed. A gateway predating these parameters ignores them and answers
	// with the whole site, which would show one creator every other creator's
	// pages. Refusing is the only safe response to a scope that was asked for
	// and not confirmed.
	const appliedPath = result.path ?? null;
	const appliedPrefix = result.pathPrefix ?? null;
	const scopeApplied = exactPath === undefined ? appliedPrefix === base && appliedPath === null : appliedPath === exactPath && appliedPrefix === null;

	if (!scopeApplied) {
		logger.error("BurrowGate did not apply the requested analytics scope", {
			requested: exactPath ?? base,
			exact: exactPath !== undefined,
			appliedPrefix,
			appliedPath,
		});
		throw new BurrowGateError(
			"The analytics gateway did not apply this blog's scope, so the results were discarded. Upgrade BurrowGate to a version that supports pathPrefix.",
		);
	}

	if (result.successfulOnly !== true) {
		logger.warn("BurrowGate did not exclude error responses from analytics", { view });
	}

	return result;
}
