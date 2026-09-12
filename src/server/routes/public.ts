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
import { renderCreatorPage, renderMainPage, renderPostPage } from "../ssr/pages.ts";
import { renderAtom, renderJsonFeed, renderRobots, renderRss, renderSitemap } from "../ssr/feeds.ts";
import { PUBLIC_ASSETS, type PublicAsset } from "../lib/public-assets.ts";
import { logger } from "../lib/logger.ts";
import type { AppState } from "../types.ts";

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

export function publicRoutes(app: Web<AppState>): void {
	for (const asset of PUBLIC_ASSETS) {
		app.get(asset.path, (ctx) => serveAsset(ctx.req, asset, true));
		// Keep old links and cached HTML working during the transition. These
		// aliases always revalidate and can be removed after older pages expire.
		app.get(asset.legacyPath, (ctx) => serveAsset(ctx.req, asset, false));
	}

	app.get("/", publicCache(), async (ctx) => {
		const topic = readTopic(ctx.req.url);
		const [creators, topics, viewer] = await Promise.all([listCreators(60, topic), listCreatorCategories(), findSignedInCreator(ctx.req)]);
		return ctx.html(renderMainPage(creators, topics, topic, viewer ?? undefined));
	});

	app.get("/creator/:username", publicCache(), async (ctx) => {
		const creator = await requireCreator(ctx.params.username);
		const filter = readFilter(ctx.req.url);
		const page = readPage(ctx.req.url);

		// Drafts are filtered in SQL rather than after the fact, so a public
		// page cannot leak one by forgetting to slice them off.
		const [posts, total] = await Promise.all([
			listPublishedByCreator(creator.username, POSTS_PER_PAGE, (page - 1) * POSTS_PER_PAGE, filter),
			countPublishedByCreator(creator.username, filter),
		]);

		// Search results are near-duplicates of the listing and unbounded in
		// number, so they are kept out of search indexes. Tag pages are not.
		const headers = filter.search === undefined ? undefined : { "X-Robots-Tag": "noindex" };
		return ctx.html(renderCreatorPage(creator, posts, filter, { page, total, perPage: POSTS_PER_PAGE }), 200, headers);
	});

	// Registered before the post route so `/creator/:username/feed.rss` is not
	// swallowed by `/creator/:username/:slug`. Feed names are not valid slugs,
	// so the two can never legitimately collide.

	app.get("/creator/:username/feed.rss", publicCache(), async (ctx) => {
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderRss(creator, posts), "application/rss+xml; charset=utf-8");
	});

	app.get("/creator/:username/feed.atom", publicCache(), async (ctx) => {
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderAtom(creator, posts), "application/atom+xml; charset=utf-8");
	});

	app.get("/creator/:username/feed.json", publicCache(), async (ctx) => {
		const { creator, posts } = await feedData(ctx.params.username);
		return xml(renderJsonFeed(creator, posts), "application/feed+json; charset=utf-8");
	});

	app.get("/creator/:username/:slug", publicCache(), async (ctx) => {
		const creator = await requireCreator(ctx.params.username);

		const slug = ctx.params.slug ?? "";
		if (!isSlugValid(slug)) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		// A draft 404s here exactly as a missing post does, so its existence is
		// not observable from outside. The author previews it at /preview/:slug.
		const post = await findPublishedPost(creator.username, slug);
		if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		return ctx.html(renderPostPage(creator, post));
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

		const post = await findPost(creator.username, slug);
		if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		const actor = ctx.get("actor");
		if (!actor.isOwner && !actor.canEditAll && post.status !== "published" && post.created_by !== actor.username) {
			throw new ApiError(ErrorCode.POST_NOT_FOUND);
		}

		return ctx.html(renderPostPage(creator, post, { preview: true }), 200, {
			"Cache-Control": "no-store, private",
			"X-Robots-Tag": "noindex, nofollow",
		});
	});

	app.get("/sitemap.xml", publicCache(), async (ctx) => {
		const [creators, posts] = await Promise.all([listCreators(1000), listAllPostRefs()]);
		return xml(renderSitemap(creators, posts), "application/xml; charset=utf-8");
	});

	app.get("/robots.txt", (ctx) => {
		return ctx.text(renderRobots(), 200, { "Cache-Control": "public, max-age=86400" });
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
