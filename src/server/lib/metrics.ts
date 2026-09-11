import { Counter, Gauge, Histogram, Registry } from "@rabbit-company/openmetrics-client";

export const registry = new Registry({ prefix: "bloggy", autoRegister: true });

export const httpRequests = new Counter({
	name: "http_requests_total",
	help: "Total HTTP requests handled, by method, route and status.",
	labelNames: ["method", "route", "status"],
	registry,
});

export const httpDuration = new Histogram({
	name: "http_request_duration_seconds",
	help: "HTTP request duration in seconds.",
	unit: "seconds",
	labelNames: ["method", "route"],
	buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
	registry,
});

export const cacheEvents = new Counter({
	name: "cache_events_total",
	help: "Page cache hits and misses.",
	labelNames: ["result"],
	registry,
});

export const pageViews = new Counter({
	name: "page_views_total",
	help: "Server-rendered blog pages served, by kind.",
	labelNames: ["kind"],
	registry,
});

export const loginAttempts = new Counter({
	name: "login_attempts_total",
	help: "Login attempts, by outcome.",
	labelNames: ["result"],
	registry,
});

export const creatorsTotal = new Gauge({
	name: "creators_total",
	help: "Registered creators.",
	registry,
});

export const postsTotal = new Gauge({
	name: "posts_total",
	help: "Published posts.",
	registry,
});

export const sessionsActive = new Gauge({
	name: "sessions_active",
	help: "Unexpired sessions.",
	registry,
});

export const cacheEntries = new Gauge({
	name: "cache_entries",
	help: "Entries currently held in the page cache.",
	registry,
});

export function metricsText(): string {
	return registry.metricsText();
}

export const METRICS_CONTENT_TYPE = Registry.contentType;
