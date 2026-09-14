import { findActiveCustomDomainByHostname } from "../db/custom-domains.ts";
import { mainHostname } from "../lib/custom-domain-host.ts";
import { isSlugValid, isUuidValid } from "../lib/validation.ts";
import type { AppMiddleware } from "../types.ts";

const FIXED_PUBLIC_PATHS = new Set(["/", "/feed.rss", "/feed.atom", "/feed.json", "/robots.txt", "/sitemap.xml"]);
const RESERVED_ROOT_SEGMENTS = new Set(["api", "assets", "creator", "health", "media", "metrics", "panel", "preview"]);

function publicMediaPath(pathname: string, username: string): boolean {
	if (pathname === `/media/avatars/${username}`) return true;
	const imagePrefix = `/media/images/${username}/`;
	return pathname.startsWith(imagePrefix) && isUuidValid(pathname.slice(imagePrefix.length));
}

function publicPath(pathname: string, username: string): boolean {
	if (FIXED_PUBLIC_PATHS.has(pathname) || pathname.startsWith("/assets/")) return true;
	if (publicMediaPath(pathname, username)) return true;
	const segments = pathname.split("/").filter(Boolean);
	return segments.length === 1 && !RESERVED_ROOT_SEGMENTS.has(segments[0]!) && isSlugValid(segments[0]);
}

function hiddenNotFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
	});
}

export function customDomainContext(): AppMiddleware {
	const primary = mainHostname();
	return async (ctx, next) => {
		const url = new URL(ctx.req.url);
		const hostname = url.hostname.toLowerCase();

		if (url.pathname === "/health") {
			ctx.set("customDomain", null);
			return await next();
		}

		if (hostname === primary) {
			ctx.set("customDomain", null);
			return await next();
		}

		const domain = await findActiveCustomDomainByHostname(hostname);
		if (!domain) return hiddenNotFound();
		if ((ctx.req.method !== "GET" && ctx.req.method !== "HEAD") || !publicPath(url.pathname, domain.username)) return hiddenNotFound();

		ctx.set("customDomain", { username: domain.username, hostname: domain.hostname, origin: `https://${domain.hostname}` });
		return await next();
	};
}
