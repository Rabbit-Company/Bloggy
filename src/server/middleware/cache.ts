import { cache, type CacheEntry, type CacheStorage } from "@rabbit-company/web-middleware/cache";
import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";
import { SESSION_COOKIE, readCookie } from "../lib/cookies.ts";
import type { AppMiddleware, AppState } from "../types.ts";

interface StoredEntry {
	entry: CacheEntry;
	deleteAt: number;
}

/**
 * The bundled `LRUCache` cannot enumerate its keys, so publishing a post could
 * only be handled by clearing everything. This variant keeps insertion order
 * for LRU eviction and exposes {@link deleteMatching}, which lets one
 * creator's pages be dropped without disturbing anyone else's.
 *
 * Freshness is decided by the cache middleware from `entry.timestamp`. This
 * class only enforces the hard retention limit (ttl + maxStaleAge).
 */
export class InvalidatableCache implements CacheStorage {
	private readonly entries = new Map<string, StoredEntry>();
	private readonly maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	async get(key: string): Promise<CacheEntry | null> {
		const stored = this.entries.get(key);
		if (!stored) return null;

		if (Date.now() > stored.deleteAt) {
			this.entries.delete(key);
			return null;
		}

		this.entries.delete(key);
		this.entries.set(key, stored);
		return stored.entry;
	}

	async set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void> {
		const lifetime = (ttl ?? config.cache.ttl) + (maxStaleAge ?? 0);
		this.entries.delete(key);
		this.entries.set(key, { entry, deleteAt: Date.now() + lifetime * 1000 });

		while (this.entries.size > this.maxSize) {
			const oldest = this.entries.keys().next();
			if (oldest.done) break;
			this.entries.delete(oldest.value);
		}
	}

	async delete(key: string): Promise<boolean> {
		return this.entries.delete(key);
	}

	async clear(): Promise<void> {
		this.entries.clear();
	}

	async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== null;
	}

	async size(): Promise<number> {
		return this.entries.size;
	}

	/**
	 * Keys are `METHOD:scope:pathname?search` (see {@link cacheKey}), so the prefix
	 * `/creator/ziga` reaches that creator's page and all of their posts. The
	 * exact list exists for paths that are a prefix of everything, notably
	 * the landing page, `/`.
	 */
	deleteByPath(prefixes: string[], exact: string[] = []): number {
		let removed = 0;
		for (const key of [...this.entries.keys()]) {
			const scopeEnd = key.indexOf(":", key.indexOf(":") + 1);
			const path = key.slice(scopeEnd + 1);
			const pathname = path.split("?")[0] ?? path;
			if (prefixes.some((prefix) => path.startsWith(prefix)) || exact.includes(pathname)) {
				this.entries.delete(key);
				removed++;
			}
		}
		return removed;
	}

	deleteByScope(scopePrefix: string): number {
		let removed = 0;
		for (const key of [...this.entries.keys()]) {
			const scope = key.slice(key.indexOf(":") + 1, key.indexOf(":", key.indexOf(":") + 1));
			if (!scope.startsWith(scopePrefix)) continue;
			this.entries.delete(key);
			removed++;
		}
		return removed;
	}
}

export const pageCache = new InvalidatableCache(config.cache.maxEntries);

/**
 * Host and resolved creator are part of the key so identical paths on two
 * custom domains can never share a response.
 */
function cacheKey(ctx: { req: Request; get(name: "customDomain"): { username: string; hostname: string } | null }): string {
	const url = new URL(ctx.req.url);
	const custom = ctx.get("customDomain");
	const scope = custom ? `creator=${custom.username}@${custom.hostname}` : url.hostname.toLowerCase();
	return `${ctx.req.method}:${scope}:${url.pathname}${url.search}`;
}

/**
 * The cache is keyed by path *and* query string, so a parameter with an
 * unbounded value space would let anyone fill the store with single-use
 * entries and evict the pages everyone actually reads. `?tag=` is not in this
 * class, since it can only usefully hold one of a creator's own tags.
 */
function hasUnboundedQuery(req: Request): boolean {
	return new URL(req.url).searchParams.has("search");
}

function addVary(response: Response, name: string): void {
	const values = (response.headers.get("Vary") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (!values.some((value) => value.toLowerCase() === name.toLowerCase())) values.push(name);
	response.headers.set("Vary", values.join(", "));
}

function setBrowserCachePolicy(response: Response, req: Request, ttl: number, isPrivate: boolean): Response {
	if (response.status >= 300 && response.status < 400) {
		response.headers.set("Cache-Control", "no-store");
	} else if (isPrivate) {
		response.headers.set("Cache-Control", "private, no-store");
	} else if (hasUnboundedQuery(req)) {
		response.headers.set("Cache-Control", "public, max-age=0, must-revalidate, s-maxage=0");
	} else {
		response.headers.set("Cache-Control", `public, max-age=0, must-revalidate, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
	}

	// A standards-compliant shared cache now keeps anonymous and signed-in
	// requests separate. The private response also carries no-store, but Vary
	// prevents an existing anonymous entry from satisfying a cookie request.
	addVary(response, "Cookie");
	addVary(response, "Authorization");
	return response;
}

export function publicCache(ttl: number = config.cache.ttl): AppMiddleware {
	const middleware = cache<AppState>({
		storage: pageCache,
		ttl,
		methods: ["GET", "HEAD"],
		keyGenerator: cacheKey,
		generateETags: true,
		staleWhileRevalidate: true,
		maxStaleAge: ttl * 2,
		addCacheHeader: true,
		cacheHeaderName: "X-Cache",
		// Never store a response to a request that carried credentials. The
		// cookie check matters as much as the header one: since the panel moved
		// to the same origin, a signed-in creator browsing their own blog sends
		// a session cookie and no Authorization header, so checking only the
		// header would let a per-viewer response into a cache everyone reads.
		shouldCache: (ctx, res) =>
			res.status === 200 && !ctx.req.headers.has("Authorization") && readCookie(ctx.req, SESSION_COOKIE) === null && !hasUnboundedQuery(ctx.req),
	});

	// `shouldCache` prevents a private response from being stored, but the
	// upstream cache checks for an existing public response before it calls that
	// predicate. Bypass lookup as well, so a session-aware public page can reach
	// its handler and render the signed-in navigation.
	return async (ctx, next) => {
		const isPrivate = ctx.req.headers.has("Authorization") || readCookie(ctx.req, SESSION_COOKIE) !== null;
		if (isPrivate) {
			const response = await next();
			return response instanceof Response ? setBrowserCachePolicy(response, ctx.req, ttl, true) : response;
		}

		const response = await middleware(ctx, next);
		return response instanceof Response ? setBrowserCachePolicy(response, ctx.req, ttl, false) : response;
	};
}

export function invalidateCreator(username: string): void {
	const removed =
		pageCache.deleteByPath([`/creator/${username}`, `/api/v1/creators/${username}`, "/api/v1/creators", "/sitemap.xml"], ["/"]) +
		pageCache.deleteByScope(`creator=${username}@`);

	logger.debug(`Invalidated ${removed} cache entries for ${username}`);
}

export async function purgeCache(): Promise<void> {
	await pageCache.clear();
	logger.info("Cache purged");
}
