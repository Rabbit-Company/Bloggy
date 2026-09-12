import { config } from "../config.ts";
import { escapeHtml, escapeJson } from "./markdown.ts";
import { SOCIAL_LABELS, SOCIAL_PREFIXES } from "../lib/constants.ts";
import { BLOG_CSS_ASSET } from "../lib/public-assets.ts";

export interface PageMeta {
	title: string;
	description: string;
	url: string;
	language: string;
	image: string;
	/**
	 * Deliberately separate from {@link image}: a post's link preview should be
	 * that post's cover, but its favicon should stay the blog's, so the tab does
	 * not change identity as a reader moves between posts of the same blog.
	 */
	icon: string;
	type: "website" | "profile" | "article";
	siteName: string;
	author?: string;
	keywords?: string;
	publishedTime?: string;
	modifiedTime?: string;
	section?: string;
	tag?: string;
	feeds?: { rss: string; atom: string; json: string };
	jsonLd?: unknown;
	twitterCreator?: string;
	theme: string;
	noindex?: boolean;
}

function twitterHandle(url: string): string {
	if (url.length === 0) return "";
	return `@${url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, "").replace(/\/$/, "")}`;
}

/**
 * Every interpolated value is escaped here rather than at the call site, so a
 * creator's title or description cannot break out of an attribute, the flaw
 * the original template-replacement approach had.
 */
export function renderPage(meta: PageMeta, body: string): string {
	const site = twitterHandle(config.site.twitter);
	const creator = meta.twitterCreator === undefined ? site : twitterHandle(meta.twitterCreator);

	const feeds =
		meta.feeds === undefined
			? ""
			: `<link rel="alternate" type="application/rss+xml" title="RSS" href="${escapeHtml(meta.feeds.rss)}">` +
				`<link rel="alternate" type="application/atom+xml" title="Atom" href="${escapeHtml(meta.feeds.atom)}">` +
				`<link rel="alternate" type="application/feed+json" title="JSON Feed" href="${escapeHtml(meta.feeds.json)}">`;

	const article =
		meta.type !== "article"
			? ""
			: [
					meta.publishedTime ? `<meta property="article:published_time" content="${escapeHtml(meta.publishedTime)}">` : "",
					meta.modifiedTime ? `<meta property="article:modified_time" content="${escapeHtml(meta.modifiedTime)}">` : "",
					meta.author ? `<meta property="article:author" content="${escapeHtml(meta.author)}">` : "",
					meta.section ? `<meta property="article:section" content="${escapeHtml(meta.section)}">` : "",
					meta.tag ? `<meta property="article:tag" content="${escapeHtml(meta.tag)}">` : "",
				].join("");

	return `<!doctype html>
<html lang="${escapeHtml(meta.language)}" data-theme="${escapeHtml(meta.theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
${meta.author ? `<meta name="author" content="${escapeHtml(meta.author)}">` : ""}
${meta.keywords ? `<meta name="keywords" content="${escapeHtml(meta.keywords)}">` : ""}
${meta.noindex ? `<meta name="robots" content="noindex">` : ""}
<meta property="og:type" content="${escapeHtml(meta.type)}">
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:description" content="${escapeHtml(meta.description)}">
<meta property="og:url" content="${escapeHtml(meta.url)}">
<meta property="og:image" content="${escapeHtml(meta.image)}">
<meta property="og:site_name" content="${escapeHtml(meta.siteName)}">
<meta name="twitter:card" content="${meta.type === "article" ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(meta.title)}">
<meta name="twitter:description" content="${escapeHtml(meta.description)}">
<meta name="twitter:image" content="${escapeHtml(meta.image)}">
${site.length > 0 ? `<meta name="twitter:site" content="${escapeHtml(site)}">` : ""}
${creator.length > 0 ? `<meta name="twitter:creator" content="${escapeHtml(creator)}">` : ""}
${article}
<link rel="canonical" href="${escapeHtml(meta.url)}">
<link rel="icon" href="${escapeHtml(meta.icon)}">
${feeds}
<link rel="stylesheet" href="${BLOG_CSS_ASSET.path}">
${meta.jsonLd === undefined ? "" : `<script type="application/ld+json">${escapeJson(meta.jsonLd)}</script>`}
${config.site.analytics}
</head>
<body>
${body}
<footer><p>Powered by <a href="${escapeHtml(config.server.domain)}">${escapeHtml(config.site.title)}</a></p></footer>
</body>
</html>`;
}

const SOCIAL_ICONS: Record<string, string> = {
	website: `<path d="M19.5 7a8.998 8.998 0 0 0-7.5-4a8.991 8.991 0 0 0-7.484 4"/><path d="M11.5 3a16.989 16.989 0 0 0-1.826 4"/><path d="M12.5 3a16.989 16.989 0 0 1 1.828 4.004"/><path d="M19.5 17a8.998 8.998 0 0 1-7.5 4a8.991 8.991 0 0 1-7.484-4"/><path d="M11.5 21a16.989 16.989 0 0 1-1.826-4"/><path d="M12.5 21a16.989 16.989 0 0 0 1.828-4.004"/><path d="M2 10l1 4l1.5-4l1.5 4l1-4"/><path d="M17 10l1 4l1.5-4l1.5 4l1-4"/><path d="M9.5 10l1 4l1.5-4l1.5 4l1-4"/>`,
	discord: `<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M7.5 7.5c3.5-1 5.5-1 9 0"/><path d="M7 16.5c3.5 1 6.5 1 10 0"/><path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833-1.667 3.5-3c.667-1.667 .5-5.833-1.5-11.5c-1.457-1.015-3-1.34-4.5-1.5l-1 2.5"/><path d="M8.5 17c0 1-1.356 3-1.832 3c-1.429 0-2.698-1.667-3.333-3c-.635-1.667-.476-5.833 1.428-11.5c1.388-1.015 2.782-1.34 4.237-1.5l1 2.5"/>`,
	twitter: `<path d="M22 4.01c-1 .49-1.98 .689-3 .99c-1.121-1.265-2.783-1.335-4.38-.737s-2.643 2.06-2.62 3.737v1c-3.245 .083-6.135-1.395-8-4c0 0-4.182 7.433 4 11c-1.872 1.247-3.739 2.088-6 2c3.308 1.803 6.913 2.423 10.034 1.517c3.58-1.04 6.522-3.723 7.651-7.742a13.84 13.84 0 0 0 .497-3.753c-.002-.249 1.51-2.772 1.818-4.013z"/>`,
	mastodon: `<path d="M18.648 15.254c-1.816 1.763-6.256 1.626-6.256 1.626s-4.44 .137-6.256-1.626"/><path d="M8 13v-4.5a2.5 2.5 0 0 1 5 0v3.5"/><path d="M13 12v-3.5a2.5 2.5 0 0 1 5 0v4.5"/><path d="M6 13.5c0 4 2 6 6 6s6-2 6-6"/>`,
	github: `<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2c2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2a4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0c-2.4-1.6-3.5-1.3-3.5-1.3a4.2 4.2 0 0 0-.1 3.2a4.6 4.6 0 0 0-1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6-.6 1.2-.5 2v3.5"/>`,
	youtube: `<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10 9l5 3l-5 3z"/>`,
	linkedin: `<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="11" x2="8" y2="16"/><line x1="8" y1="8" x2="8" y2="8.01"/><line x1="12" y1="16" x2="12" y2="11"/><path d="M16 16v-3a2 2 0 0 0-4 0"/>`,
	instagram: `<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/><line x1="16.5" y1="7.5" x2="16.5" y2="7.501"/>`,
	email: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6l9-6"/>`,
};

const FEED_ICON = `<path d="M4 4a16 16 0 0 1 16 16"/><path d="M4 11a9 9 0 0 1 9 9"/><circle cx="4" cy="18" r="1"/>`;

export function renderSocial(social: Record<string, string>, feedUrl?: string): string {
	const links = Object.entries(social)
		.filter(([platform, url]) => platform in SOCIAL_PREFIXES && typeof url === "string" && url.length > 0)
		.map(([platform, url]) => {
			const icon = SOCIAL_ICONS[platform];
			if (icon === undefined) return "";
			const href = platform === "email" ? `mailto:${url}` : url;
			const label = SOCIAL_LABELS[platform] ?? platform;
			return `<a href="${escapeHtml(href)}" rel="me noopener" target="_blank" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></a>`;
		})
		.join("");

	const feed =
		feedUrl === undefined
			? ""
			: `<a class="feed" href="${escapeHtml(feedUrl)}" type="application/rss+xml" title="RSS feed" aria-label="RSS feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FEED_ICON}</svg></a>`;

	const row = `${links}${feed}`;
	return row.length === 0 ? "" : `<div class="social">${row}</div>`;
}

export function siteSocial(): string {
	return renderSocial({
		...(config.site.website.length > 0 ? { website: config.site.website } : {}),
		...(config.site.discord.length > 0 ? { discord: config.site.discord } : {}),
		...(config.site.twitter.length > 0 ? { twitter: config.site.twitter } : {}),
		...(config.site.github.length > 0 ? { github: config.site.github } : {}),
	});
}

export function formatDate(iso: string): string {
	return iso.slice(0, 10);
}
