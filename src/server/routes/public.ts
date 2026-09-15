import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { isCategoryValid, isPostTagValid, isSlugValid, isUsernameValid } from "../lib/validation.ts";
import { findCreator, isEmailVerified, isSuspended, listCreatorCategories, listCreators } from "../db/creators.ts";
import { countPublishedByCreator, findPost, findPublishedPost, listAllPostRefs, listPublishedByCreator, type PostFilter } from "../db/posts.ts";
import { sql } from "../db/index.ts";
import { publicCache } from "../middleware/cache.ts";
import { findSignedInCreator, requireAuth } from "../middleware/auth.ts";
import { ok } from "../lib/response.ts";
import type { PublicConfig } from "../../shared/constants.ts";
import { analyticsEnabled } from "../lib/burrowgate.ts";
import {
	customPageLocation,
	renderCreatorPage,
	renderEmbedCreatorPage,
	renderEmbedPostPage,
	renderMainPage,
	renderPostPage,
	type PublicPageLocation,
} from "../ssr/pages.ts";
import { findCustomization } from "../db/customizations.ts";
import { findEmbedCustomization } from "../db/embeds.ts";
import { renderAtom, renderCreatorSitemap, renderJsonFeed, renderRobots, renderRss, renderSitemap } from "../ssr/feeds.ts";
import { PUBLIC_ASSETS, type PublicAsset } from "../lib/public-assets.ts";
import { logger } from "../lib/logger.ts";
import type { AppContext, AppState } from "../types.ts";
import { findActiveCustomDomainByUsername } from "../db/custom-domains.ts";

const POSTS_PER_PAGE = 12;

const MAX_SEARCH_LENGTH = 100;

/** Upper bound on `?page=`, so a crawler cannot walk to an unbounded number. */
const MAX_PAGE = 1000;

const FEED_LIMIT = 20;

const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";

function serveAsset(req: Request, asset: PublicAsset, immutable: boolean): Response {
	const headers = {
		"Content-Type": asset.contentType,
		"Cache-Control": immutable ? IMMUTABLE_ASSET_CACHE : "no-cache",
		ETag: asset.etag,
	};

	if (req.headers.get("If-None-Match") === asset.etag) return new Response(null, { status: 304, headers });
	return new Response(asset.body, { headers });
}

function xml(body: string, contentType: string): Response {
	return new Response(body, {
		headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${config.cache.ttl}` },
	});
}

async function creatorListing(ctx: AppContext, username: string, location?: PublicPageLocation): Promise<Response> {
	const creator = await requireCreator(username);
	const filter = readFilter(ctx.req.url);
	const page = readPage(ctx.req.url);
	const [posts, total, customization] = await Promise.all([
		listPublishedByCreator(creator.username, POSTS_PER_PAGE, (page - 1) * POSTS_PER_PAGE, filter),
		countPublishedByCreator(creator.username, filter),
		findCustomization(creator.username),
	]);
	const headers = filter.search === undefined ? undefined : { "X-Robots-Tag": "noindex" };
	return ctx.html(renderCreatorPage(creator, posts, filter, { page, total, perPage: POSTS_PER_PAGE }, customization, location), 200, headers);
}

async function creatorPost(ctx: AppContext, username: string, slug: string, location?: PublicPageLocation): Promise<Response> {
	const creator = await requireCreator(username);
	if (!isSlugValid(slug)) throw new ApiError(ErrorCode.POST_NOT_FOUND);
	const [post, customization] = await Promise.all([findPublishedPost(creator.username, slug), findCustomization(creator.username)]);
	if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);
	return ctx.html(renderPostPage(creator, post, location ? { location } : {}, customization));
}

async function embedListing(ctx: AppContext, username: string, location?: PublicPageLocation): Promise<Response> {
	const creator = await requireCreator(username);
	const filter = readFilter(ctx.req.url);
	const page = readPage(ctx.req.url);
	const [posts, total, embed] = await Promise.all([
		listPublishedByCreator(creator.username, POSTS_PER_PAGE, (page - 1) * POSTS_PER_PAGE, filter),
		countPublishedByCreator(creator.username, filter),
		findEmbedCustomization(creator.username),
	]);
	return ctx.html(renderEmbedCreatorPage(creator, posts, filter, { page, total, perPage: POSTS_PER_PAGE }, embed, location), 200, {
		"X-Robots-Tag": "noindex, nofollow",
	});
}

async function embedPost(ctx: AppContext, username: string, slug: string, location?: PublicPageLocation): Promise<Response> {
	const creator = await requireCreator(username);
	if (!isSlugValid(slug)) throw new ApiError(ErrorCode.POST_NOT_FOUND);
	const [post, embed] = await Promise.all([findPublishedPost(creator.username, slug), findEmbedCustomization(creator.username)]);
	if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);
	return ctx.html(renderEmbedPostPage(creator, post, embed, location), 200, { "X-Robots-Tag": "noindex, nofollow" });
}

async function redirectToCustomDomain(ctx: AppContext, username: string, pathname: string): Promise<Response | null> {
	const domain = await findActiveCustomDomainByUsername(username);
	if (!domain) return null;
	const incoming = new URL(ctx.req.url);
	const target = new URL(pathname, `https://${domain.hostname}`);
	target.search = incoming.search;
	return ctx.redirect(target.toString(), 302);
}

export function publicRoutes(app: Web<AppState>): void {
	for (const asset of PUBLIC_ASSETS) {
		app.get(asset.path, (ctx) => serveAsset(ctx.req, asset, true));
		// Keep old links and cached HTML working during the transition. These
		// aliases always revalidate and can be removed after older pages expire.
		app.get(asset.legacyPath, (ctx) => serveAsset(ctx.req, asset, false));
	}

	app.get("/", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (custom) return await creatorListing(ctx, custom.username, customPageLocation(custom.origin));
		const topic = readTopic(ctx.req.url);
		const [creators, topics, viewer] = await Promise.all([listCreators(60, topic), listCreatorCategories(), findSignedInCreator(ctx.req)]);
		return ctx.html(renderMainPage(creators, topics, topic, viewer ?? undefined));
	});

	app.get("/creator/:username", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		return (await redirectToCustomDomain(ctx, username, "/")) ?? (await creatorListing(ctx, username));
	});

	app.get("/creator/:username/_embed", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		return (await redirectToCustomDomain(ctx, username, "/_embed")) ?? (await embedListing(ctx, username));
	});

	app.get("/creator/:username/_embed/:slug", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		const slug = ctx.params.slug ?? "";
		const redirected = await redirectToCustomDomain(ctx, username, `/_embed/${encodeURIComponent(slug)}`);
		return redirected ?? (await embedPost(ctx, username, slug));
	});

	app.get("/_embed", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		return await embedListing(ctx, custom.username, customPageLocation(custom.origin));
	});

	app.get("/_embed/:slug", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		return await embedPost(ctx, custom.username, ctx.params.slug ?? "", customPageLocation(custom.origin));
	});

	// Registered before the post route so `/creator/:username/feed.rss` is not
	// swallowed by `/creator/:username/:slug`. Feed names are not valid slugs,
	// so the two can never legitimately collide.

	app.get("/creator/:username/feed.rss", publicCache(), async (ctx) => {
		const redirected = await redirectToCustomDomain(ctx, ctx.params.username ?? "", "/feed.rss");
		if (redirected) return redirected;
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderRss(creator, posts), "application/rss+xml; charset=utf-8");
	});

	app.get("/creator/:username/feed.atom", publicCache(), async (ctx) => {
		const redirected = await redirectToCustomDomain(ctx, ctx.params.username ?? "", "/feed.atom");
		if (redirected) return redirected;
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderAtom(creator, posts), "application/atom+xml; charset=utf-8");
	});

	app.get("/creator/:username/feed.json", publicCache(), async (ctx) => {
		const redirected = await redirectToCustomDomain(ctx, ctx.params.username ?? "", "/feed.json");
		if (redirected) return redirected;
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderJsonFeed(creator, posts), "application/feed+json; charset=utf-8");
	});

	app.get("/creator/:username/:slug", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		const slug = ctx.params.slug ?? "";
		const redirected = await redirectToCustomDomain(ctx, username, `/${encodeURIComponent(slug)}`);
		return redirected ?? (await creatorPost(ctx, username, slug));
	});

	/**
	 * Deliberately a separate path rather than a signed-in view of the public
	 * URL: the public routes are cached, and a response varying by viewer could
	 * be stored and then served to everyone. This route requires a session,
	 * carries no caching middleware and is marked `no-store`, so a draft can
	 * never end up in a shared cache.
	 */
	app.get("/preview/:slug", requireAuth(), async (ctx) => {
		const creator = ctx.get("creator");
		const slug = ctx.params.slug ?? "";
		if (!isSlugValid(slug)) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		const [post, customization] = await Promise.all([findPost(creator.username, slug), findCustomization(creator.username)]);
		if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		const actor = ctx.get("actor");
		if (!actor.isOwner && !actor.canEditAll && post.status !== "published" && post.created_by !== actor.username) {
			throw new ApiError(ErrorCode.POST_NOT_FOUND);
		}

		return ctx.html(renderPostPage(creator, post, { preview: true }, customization), 200, {
			"Cache-Control": "no-store, private",
			"X-Robots-Tag": "noindex, nofollow",
		});
	});

	app.get("/sitemap.xml", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (custom) {
			const creator = await requireCreator(custom.username);
			const posts = (await listAllPostRefs()).filter((post) => post.username === custom.username);
			return xml(renderCreatorSitemap(creator, posts, customPageLocation(custom.origin)), "application/xml; charset=utf-8");
		}
		const [creators, posts] = await Promise.all([listCreators(1000), listAllPostRefs()]);
		return xml(renderSitemap(creators, posts), "application/xml; charset=utf-8");
	});

	app.get("/robots.txt", (ctx) => {
		const custom = ctx.get("customDomain");
		return ctx.text(renderRobots(custom?.origin), 200, { "Cache-Control": "public, max-age=86400" });
	});

	app.get("/api/v1/config", publicCache(60), (ctx) => {
		const body: PublicConfig = {
			registrationEnabled: config.limits.registrationEnabled,
			passwordResetEnabled: config.smtp.enabled,
			emailConfirmationEnabled: config.smtp.enabled,
			minPasswordEntropy: config.limits.minPasswordEntropy,
			maxAvatarSize: config.limits.maxAvatarSize,
			maxImageSize: config.limits.maxImageSize,
			maxAccountStorage: Math.max(0, config.limits.maxAccountStorage),
			siteTitle: config.site.title,
			analytics: analyticsEnabled() ? "burrowgate" : "none",
		};
		return ok(ctx, body);
	});

	app.get("/health", async (ctx) => {
		try {
			await sql`SELECT 1 AS ok`;
			return ctx.json({ status: "ok", database: config.database.dialect });
		} catch (err) {
			logger.error("Health check failed", { error: String(err) });
			return ctx.json({ status: "error", database: config.database.dialect }, 503);
		}
	});

	app.get("/feed.rss", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		const { creator, posts } = await feedData(custom.username);
		return xml(renderRss(creator, posts, customPageLocation(custom.origin)), "application/rss+xml; charset=utf-8");
	});

	app.get("/feed.atom", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		const { creator, posts } = await feedData(custom.username);
		return xml(renderAtom(creator, posts, customPageLocation(custom.origin)), "application/atom+xml; charset=utf-8");
	});

	app.get("/feed.json", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		const { creator, posts } = await feedData(custom.username);
		return xml(renderJsonFeed(creator, posts, customPageLocation(custom.origin)), "application/feed+json; charset=utf-8");
	});
}

/** Registered last so normal one-segment routes such as /metrics win first. */
export function customDomainPostRoute(app: Web<AppState>): void {
	app.get("/:customDomainSlug", publicCache(), async (ctx) => {
		const custom = ctx.get("customDomain");
		if (!custom) throw new ApiError(ErrorCode.NOT_FOUND);
		return await creatorPost(ctx, custom.username, ctx.params.customDomainSlug ?? "", customPageLocation(custom.origin));
	});
}

/**
 * The 1-based page number, clamped to something a crawler cannot run away with.
 *
 * An out-of-range page renders an empty grid rather than an error, which is
 * what a browser doing infinite scroll expects when it reaches the end.
 */
function readPage(rawUrl: string): number {
	const raw = Number.parseInt(new URL(rawUrl).searchParams.get("page") ?? "1", 10);
	if (!Number.isFinite(raw) || raw < 1) return 1;
	return Math.min(raw, MAX_PAGE);
}

function readFilter(rawUrl: string): PostFilter {
	const params = new URL(rawUrl).searchParams;

	const tag = params.get("tag")?.trim() ?? "";
	if (isPostTagValid(tag)) return { tag };

	const search = params.get("search")?.trim() ?? "";
	if (search.length > 0) return { search: search.slice(0, MAX_SEARCH_LENGTH) };

	return {};
}

function readTopic(rawUrl: string): string | undefined {
	const topic = new URL(rawUrl).searchParams.get("topic")?.trim() ?? "";
	return isCategoryValid(topic) ? topic : undefined;
}

async function requireCreator(username: string | undefined) {
	if (!isUsernameValid(username)) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);

	const creator = await findCreator(username);
	// A suspended blog 404s exactly as a missing one, so suspension is not
	// observable from outside and the pages stop resolving immediately.
	if (!creator || isSuspended(creator) || !isEmailVerified(creator)) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);
	return creator;
}

async function feedData(username: string | undefined) {
	const creator = await requireCreator(username);
	const posts = await listPublishedByCreator(creator.username, FEED_LIMIT);
	return { creator, posts };
}
