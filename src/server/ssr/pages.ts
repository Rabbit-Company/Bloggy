import { config } from "../config.ts";
import { avatarUrl, pictureUrl } from "../lib/storage.ts";
import { parseSocial, parseThemeColors, type CreatorRow } from "../db/creators.ts";
import { EMPTY_CUSTOMIZATION, type CreatorCustomization } from "../db/customizations.ts";
import type { PostFilter, PostRow, PostSummaryRow } from "../db/posts.ts";
import { escapeHtml } from "./markdown.ts";
import { renderMarkdown } from "./markdown.ts";
import { formatDate, renderPage, renderSocial, siteSocial, type PageMeta } from "./layout.ts";
import { BLOG_JS_ASSET, LOGO_PNG_ASSET, LOGO_SVG_ASSET } from "../lib/public-assets.ts";
import { renderTemplate } from "../lib/customization.ts";

const domain = config.server.domain;

export function creatorUrl(username: string): string {
	return `${domain}/creator/${username}`;
}

export function postUrl(username: string, slug: string): string {
	return `${domain}/creator/${username}/${slug}`;
}

function renderTagline(description: string): string {
	const text = description.trim();
	return text.length === 0 ? "" : `\n\t<p>${escapeHtml(text)}</p>`;
}

function feedsFor(username: string): PageMeta["feeds"] {
	const base = creatorUrl(username);
	return { rss: `${base}/feed.rss`, atom: `${base}/feed.atom`, json: `${base}/feed.json` };
}

/**
 * Autodiscovery needs an absolute URL, but a link someone clicks should stay on
 * whichever host they reached the site by. Behind a proxy, or in development,
 * that is not always the configured domain.
 */
function feedLink(username: string): string {
	return `/creator/${encodeURIComponent(username)}/feed.rss`;
}

function themeOf(creator: CreatorRow): string {
	return creator.theme === "dark" || creator.theme === "light" || creator.theme === "custom" ? creator.theme : "auto";
}

function isDarkColor(hex: string): boolean {
	const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
	const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
	const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
	const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue) < 0.18;
}

function creatorCss(creator: CreatorRow, customization: CreatorCustomization): string {
	const custom = customization.customCss.trim();
	if (creator.theme !== "custom") return custom;
	const colors = parseThemeColors(creator.theme_colors);
	const theme = `[data-theme="custom"] {
	color-scheme: ${isDarkColor(colors.background) ? "dark" : "light"};
	--bg: ${colors.background};
	--surface: ${colors.surface};
	--text: ${colors.text};
	--muted: ${colors.muted};
	--border: ${colors.border};
	--accent: ${colors.accent};
	--accent-hover: color-mix(in srgb, ${colors.accent} 82%, black);
	--code-bg: color-mix(in srgb, ${colors.surface} 84%, ${colors.text});
	--scroll-track: ${colors.surface};
	--scroll-thumb: ${colors.border};
	--scroll-thumb-hover: ${colors.muted};
	--shadow: 0 18px 50px color-mix(in srgb, ${colors.text} 10%, transparent);
}`;
	return custom.length === 0 ? theme : `${theme}\n${custom}`;
}

function topicUrl(topic?: string): string {
	return topic === undefined ? "/" : `/?topic=${encodeURIComponent(topic)}`;
}

function renderTopicFilters(topics: string[], activeTopic?: string): string {
	const filters = [
		`<a class="topic-pill${activeTopic === undefined ? " active" : ""}" href="/"${activeTopic === undefined ? ' aria-current="page"' : ""}>All topics</a>`,
		...topics.map(
			(topic) =>
				`<a class="topic-pill${topic === activeTopic ? " active" : ""}" href="${escapeHtml(topicUrl(topic))}"${topic === activeTopic ? ' aria-current="page"' : ""}>${escapeHtml(topic)}</a>`,
		),
	].join("\n");

	return `<nav class="topic-filter" aria-label="Filter creators by topic">
	<div class="topic-filter-heading">
		<div>
			<span class="section-kicker">Discover</span>
			<h2>Find your next favorite creator</h2>
		</div>
		${activeTopic === undefined ? "" : `<a class="clear-topic" href="/">Clear filter</a>`}
	</div>
	<div class="topic-pills">${filters}</div>
</nav>`;
}

export function renderMainPage(creators: CreatorRow[], topics: string[] = [], activeTopic?: string, viewer?: Pick<CreatorRow, "username">): string {
	const cards = creators
		.map(
			(creator) => `<li class="creator-card">
	<a class="creator-avatar" href="/creator/${escapeHtml(creator.username)}"><img src="${escapeHtml(avatarUrl(creator.username))}" alt="" loading="lazy" width="128" height="128"></a>
	<div class="creator-card-body">
		<a class="creator-topic" href="${escapeHtml(topicUrl(creator.category))}">${escapeHtml(creator.category)}</a>
		<h3><a href="/creator/${escapeHtml(creator.username)}">${escapeHtml(creator.author)}</a></h3>
		<p>${escapeHtml(creator.title)}</p>
		<a class="view-blog" href="/creator/${escapeHtml(creator.username)}">View blog <span aria-hidden="true">&rarr;</span></a>
	</div>
</li>`,
		)
		.join("\n");

	const primaryAction =
		viewer !== undefined
			? `<a class="home-button primary" href="/panel">Go to your panel <span aria-hidden="true">&rarr;</span></a>`
			: config.limits.registrationEnabled
				? `<a class="home-button primary" href="/panel/register">Create your blog <span aria-hidden="true">&rarr;</span></a>`
				: "";
	const accountActions =
		viewer === undefined
			? `<a class="home-login" href="/panel">Sign in</a>
		${config.limits.registrationEnabled ? `<a class="home-button compact" href="/panel/register">Create account</a>` : ""}`
			: `<a class="home-login" href="/creator/${escapeHtml(viewer.username)}">My blog</a>
		<a class="home-button compact" href="/panel">Open panel</a>`;
	const empty = activeTopic === undefined ? "No blogs published yet." : `No creators are writing about ${escapeHtml(activeTopic)} yet.`;
	const title = activeTopic === undefined ? config.site.title : `${activeTopic} blogs · ${config.site.title}`;
	const canonical = `${domain}${topicUrl(activeTopic)}`;

	const body = `<main class="home-wrap">
<header class="home-header">
	<a class="home-brand" href="/" aria-label="${escapeHtml(config.site.title)} home">
		<img src="${LOGO_SVG_ASSET.path}" alt="" width="36" height="36">
		<span>${escapeHtml(config.site.title)}</span>
	</a>
	<nav class="home-account" aria-label="Account">
		${accountActions}
	</nav>
</header>
<section class="home-hero">
	<div class="hero-copy">
		<span class="hero-eyebrow">Independent voices, all in one place</span>
		<h1>Stories worth reading.<br><span>People worth following.</span></h1>
		<p>${escapeHtml(config.site.description)} Explore thoughtful blogs by topic, or start sharing ideas of your own.</p>
		<div class="hero-actions">
			${primaryAction}
			<a class="home-button secondary" href="#creators">Explore creators</a>
		</div>
	</div>
	<div class="hero-mark" aria-hidden="true">
		<span class="hero-orbit one"></span>
		<span class="hero-orbit two"></span>
		<div class="hero-logo"><img src="${LOGO_SVG_ASSET.path}" alt="" width="132" height="132"></div>
	</div>
</section>
<section class="creator-directory" id="creators">
	${renderTopicFilters(topics, activeTopic)}
	${creators.length === 0 ? `<div class="directory-empty"><p>${empty}</p>${activeTopic === undefined ? "" : `<a href="/">Browse all creators</a>`}</div>` : `<ul class="creators">\n${cards}\n</ul>`}
</section>
<div class="home-social">${siteSocial()}</div>
</main>`;

	return renderPage(
		{
			title,
			description: config.site.description,
			url: canonical,
			language: config.site.language,
			image: `${domain}${LOGO_PNG_ASSET.path}`,
			icon: `${domain}${LOGO_SVG_ASSET.path}`,
			type: "website",
			siteName: config.site.title,
			author: config.site.author,
			theme: "auto",
			jsonLd: {
				"@context": "https://schema.org",
				"@type": "WebSite",
				name: config.site.title,
				description: config.site.description,
				url: domain,
			},
		},
		body,
	);
}

export function tagUrl(username: string, tag: string): string {
	return `/creator/${encodeURIComponent(username)}?tag=${encodeURIComponent(tag)}`;
}

function postCard(creator: CreatorRow, post: PostSummaryRow): string {
	const href = `/creator/${escapeHtml(creator.username)}/${escapeHtml(post.slug)}`;
	return `<article class="card">
	<a href="${href}"><img class="cover" src="${escapeHtml(pictureUrl(creator.username, post.picture))}" alt="${escapeHtml(post.title)}" loading="lazy"></a>
	<div class="body">
		<a class="tag" href="${escapeHtml(tagUrl(creator.username, post.tag))}">${escapeHtml(post.tag)}</a>
		<h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
		<p>${escapeHtml(post.description)}</p>
		<div class="meta">
			<a href="/creator/${escapeHtml(creator.username)}"><img src="${escapeHtml(avatarUrl(creator.username))}" alt="${escapeHtml(creator.author)}" loading="lazy"></a>
			<div>
				<a class="name" href="/creator/${escapeHtml(creator.username)}">${escapeHtml(creator.author)}</a>
				<span class="dateline"><time datetime="${escapeHtml(post.published_at ?? post.created_at)}">${escapeHtml(formatDate(post.published_at ?? post.created_at))}</time> &middot; ${post.read_time} min read</span>
			</div>
		</div>
	</div>
</article>`;
}

function renderSearch(username: string, active: string): string {
	return `<form class="search-form" method="get" action="/creator/${escapeHtml(username)}" role="search">
	<input class="search" type="search" name="search" value="${escapeHtml(active)}"
		placeholder="Search" aria-label="Search posts" enterkeyhint="search" maxlength="100">
</form>`;
}

function renderTagNote(username: string, tag: string): string {
	return `<p class="filter-note">Posts tagged <strong>${escapeHtml(tag)}</strong>
	&middot; <a href="/creator/${escapeHtml(username)}">show all</a></p>`;
}

/** Page two onwards says so, so search results are not all identically titled. */
function pageTitle(title: string, filter: PostFilter, page: number): string {
	const base = filter.tag === undefined ? title : `${filter.tag} · ${title}`;
	return page > 1 ? `${base} · page ${page}` : base;
}

function emptyMessage(filter: PostFilter): string {
	if (filter.tag !== undefined) return `Nothing tagged &ldquo;${escapeHtml(filter.tag)}&rdquo;.`;
	if (filter.search !== undefined) return `Nothing matches &ldquo;${escapeHtml(filter.search)}&rdquo;.`;
	return "No posts yet.";
}

export interface Pagination {
	page: number;
	total: number;
	perPage: number;
}

/**
 * The query string for a page of this listing, preserving any active filter.
 * Page one carries no `page` parameter, so the first page keeps a clean URL.
 */
function listingQuery(filter: PostFilter, page: number): string {
	const params = new URLSearchParams();
	if (filter.tag !== undefined) params.set("tag", filter.tag);
	if (filter.search !== undefined) params.set("search", filter.search);
	if (page > 1) params.set("page", String(page));

	const query = params.toString();
	return query.length === 0 ? "" : `?${query}`;
}

export function renderCreatorPage(
	creator: CreatorRow,
	posts: PostSummaryRow[],
	filter: PostFilter = {},
	paging: Pagination = { page: 1, total: posts.length, perPage: posts.length || 1 },
	customization: CreatorCustomization = EMPTY_CUSTOMIZATION,
): string {
	const social = parseSocial(creator.social);
	const cards = posts.map((post) => postCard(creator, post)).join("\n");

	const base = `/creator/${creator.username}`;
	const hasMore = paging.page * paging.perPage < paging.total;

	const header = `<header class="masthead">
	<h1><a href="/creator/${escapeHtml(creator.username)}">${escapeHtml(creator.title)}</a></h1>${renderTagline(creator.description)}
	${renderSocial(social, feedLink(creator.username))}
</header>`;
	const search = renderSearch(creator.username, filter.search ?? "");
	const filterNote = filter.tag === undefined ? "" : renderTagNote(creator.username, filter.tag);
	const postList = posts.length === 0 ? `<p class="empty">${emptyMessage(filter)}</p>` : `<div class="grid">\n${cards}\n</div>`;
	const pagination = hasMore
		? `<div class="more-wrap"><a class="more" rel="next" href="${escapeHtml(base)}${escapeHtml(listingQuery(filter, paging.page + 1))}">Load more posts</a></div>\n<script src="${BLOG_JS_ASSET.path}" defer></script>`
		: "";
	const body =
		customization.homeTemplate.length > 0
			? renderTemplate(customization.homeTemplate, {
					"bloggy-header": header,
					"bloggy-search": search,
					"bloggy-filter": filterNote,
					"bloggy-posts": postList,
					"bloggy-pagination": pagination,
				})
			: `<main class="wrap">
${header}
${search}
${filterNote}${postList}${pagination}
</main>`;

	// A tag page is a real, bounded view of the blog and worth indexing under
	// its own URL. Search results are not: they are unbounded, near-duplicate
	// pages, so they stay out of the index and off the canonical URL.
	const canonical =
		filter.search !== undefined
			? creatorUrl(creator.username)
			: `${creatorUrl(creator.username)}${listingQuery({ ...filter, search: undefined }, paging.page)}`;

	return renderPage(
		{
			title: pageTitle(creator.title, filter, paging.page),
			description: creator.description,
			url: canonical,
			language: creator.language,
			image: avatarUrl(creator.username),
			icon: avatarUrl(creator.username),
			type: "profile",
			siteName: config.site.title,
			author: creator.author,
			twitterCreator: social.twitter,
			theme: themeOf(creator),
			customCss: creatorCss(creator, customization),
			feeds: feedsFor(creator.username),
			noindex: filter.search !== undefined,
			jsonLd: {
				"@context": "https://schema.org",
				"@type": "Blog",
				name: creator.title,
				description: creator.description,
				url: creatorUrl(creator.username),
				inLanguage: creator.language,
				author: { "@type": "Person", name: creator.author, url: creatorUrl(creator.username) },
			},
		},
		body,
	);
}

export interface PostPageOptions {
	preview?: boolean;
}

export function renderPostPage(
	creator: CreatorRow,
	post: PostRow,
	options: PostPageOptions = {},
	customization: CreatorCustomization = EMPTY_CUSTOMIZATION,
): string {
	const social = parseSocial(creator.social);
	const url = postUrl(creator.username, post.slug);
	const picture = pictureUrl(creator.username, post.picture);
	const keywords = post.keywords
		.split(",")
		.map((k) => k.trim())
		.filter((k) => k.length > 0);

	const shareText = encodeURIComponent(`${post.title}\n\n${url}`);
	const content = renderMarkdown(post.markdown);

	const header = `<header class="masthead">
	<h2><a href="/creator/${escapeHtml(creator.username)}">${escapeHtml(creator.title)}</a></h2>${renderTagline(creator.description)}
	${renderSocial(social, feedLink(creator.username))}
	</header>`;
	const preview =
		options.preview === true
			? `<div class="preview-banner">${
					post.status === "published"
						? "Preview of a published post."
						: `This post is ${post.status === "review" ? "in review" : post.status === "changes" ? "waiting for changes" : "a draft"}. Only your team can see this page, and it is hidden from your blog, feeds and search engines.`
				}</div>`
			: "";
	const postTitle = `<h1>${escapeHtml(post.title)}</h1>`;
	const byline = `<div class="byline">
		<a href="/creator/${escapeHtml(creator.username)}"><img src="${escapeHtml(avatarUrl(creator.username))}" alt="${escapeHtml(creator.author)}"></a>
		<div>
			<a class="name" href="/creator/${escapeHtml(creator.username)}">${escapeHtml(creator.author)}</a>
			<time datetime="${escapeHtml(post.published_at ?? post.created_at)}">${escapeHtml(formatDate(post.published_at ?? post.created_at))}</time> &middot; ${post.read_time} min read
		</div>
	</div>`;
	const postContent = `<div class="content">
${content}
	</div>`;
	const share = `<a class="share" href="https://twitter.com/intent/tweet?text=${shareText}" target="_blank" rel="noopener">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 4.01c-1 .49-1.98 .689-3 .99c-1.121-1.265-2.783-1.335-4.38-.737s-2.643 2.06-2.62 3.737v1c-3.245 .083-6.135-1.395-8-4c0 0-4.182 7.433 4 11c-1.872 1.247-3.739 2.088-6 2c3.308 1.803 6.913 2.423 10.034 1.517c3.58-1.04 6.522-3.723 7.651-7.742a13.84 13.84 0 0 0 .497-3.753c-.002-.249 1.51-2.772 1.818-4.013z"/></svg>
		Share
	</a>`;
	const body =
		customization.postTemplate.length > 0
			? renderTemplate(customization.postTemplate, {
					"bloggy-header": header,
					"bloggy-preview": preview,
					"bloggy-post-title": postTitle,
					"bloggy-byline": byline,
					"bloggy-post-content": postContent,
					"bloggy-share": share,
				})
			: `<main class="wrap">
${header}
<article class="post narrow">
${preview}
${postTitle}
${byline}
${postContent}
${share}
</article>
</main>`;

	return renderPage(
		{
			title: post.title,
			description: post.description,
			url,
			language: post.language,
			image: picture,
			icon: avatarUrl(creator.username),
			type: "article",
			siteName: creator.title,
			author: creator.author,
			keywords: keywords.join(", "),
			publishedTime: post.published_at ?? post.created_at,
			modifiedTime: post.updated_at,
			noindex: options.preview === true,
			section: post.category,
			tag: post.tag,
			twitterCreator: social.twitter,
			theme: themeOf(creator),
			customCss: creatorCss(creator, customization),
			feeds: feedsFor(creator.username),
			jsonLd: {
				"@context": "https://schema.org",
				"@type": "BlogPosting",
				headline: post.title,
				description: post.description,
				url,
				mainEntityOfPage: { "@type": "WebPage", "@id": url },
				image: [picture, avatarUrl(creator.username)],
				keywords,
				articleSection: post.category,
				wordCount: post.word_count,
				inLanguage: post.language,
				datePublished: post.published_at ?? post.created_at,
				dateModified: post.updated_at,
				author: { "@type": "Person", name: creator.author, url: creatorUrl(creator.username) },
				publisher: { "@type": "Organization", name: creator.title, url: creatorUrl(creator.username) },
			},
		},
		body,
	);
}

export function renderErrorPage(status: number, message: string): string {
	const body = `<main class="wrap">
<header class="masthead">
	<h1>${status}</h1>
	<p>${escapeHtml(message)}</p>
	<p><a href="/">Back to ${escapeHtml(config.site.title)}</a></p>
</header>
</main>`;

	return renderPage(
		{
			title: `${status} · ${config.site.title}`,
			description: message,
			url: domain,
			language: config.site.language,
			image: `${domain}${LOGO_PNG_ASSET.path}`,
			icon: `${domain}${LOGO_SVG_ASSET.path}`,
			type: "website",
			siteName: config.site.title,
			theme: "auto",
			noindex: true,
		},
		body,
	);
}
