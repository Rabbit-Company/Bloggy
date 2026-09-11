import { config } from "../config.ts";
import { avatarUrl, pictureUrl } from "../lib/storage.ts";
import { parseSocial, type CreatorRow } from "../db/creators.ts";
import type { PostSummaryRow } from "../db/posts.ts";
import { escapeXml } from "./markdown.ts";
import { creatorUrl, postUrl } from "./pages.ts";

const domain = config.server.domain;

/**
 * The closing sequence is split so a title containing `]]>` cannot terminate
 * the section early.
 */
function cdata(value: string): string {
	return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

export function renderRss(creator: CreatorRow, posts: PostSummaryRow[]): string {
	const link = creatorUrl(creator.username);
	const avatar = avatarUrl(creator.username);
	const social = parseSocial(creator.social);
	const author = social.email === undefined ? "" : `<author>${escapeXml(social.email)} (${escapeXml(creator.author)})</author>`;

	const items = posts
		.map((post) => {
			const url = postUrl(creator.username, post.slug);
			return `<item><title>${cdata(post.title)}</title><link>${escapeXml(url)}</link><guid isPermaLink="true">${escapeXml(url)}</guid><pubDate>${new Date(post.published_at ?? post.created_at).toUTCString()}</pubDate><description>${cdata(post.description)}</description><category>${escapeXml(post.tag)}</category>${author}<enclosure url="${escapeXml(pictureUrl(creator.username, post.picture))}" length="0" type="image/jpeg"/></item>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${cdata(creator.title)}</title><link>${escapeXml(link)}</link><description>${cdata(creator.description)}</description><language>${escapeXml(creator.language)}</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate><category>${escapeXml(creator.category)}</category><copyright>${new Date().getFullYear()} ${escapeXml(creator.author)}, All rights reserved.</copyright><image><title>${cdata(creator.author)}</title><url>${escapeXml(avatar)}</url><link>${escapeXml(link)}</link></image><atom:link rel="self" href="${escapeXml(`${link}/feed.rss`)}" type="application/rss+xml"/>${items}</channel></rss>`;
}

export function renderAtom(creator: CreatorRow, posts: PostSummaryRow[]): string {
	const link = creatorUrl(creator.username);
	const avatar = avatarUrl(creator.username);
	const social = parseSocial(creator.social);
	const email = social.email === undefined ? "" : `<email>${escapeXml(social.email)}</email>`;
	const updated = posts[0]?.updated_at ?? creator.created_at;

	const entries = posts
		.map((post) => {
			const url = postUrl(creator.username, post.slug);
			return `<entry><title type="html">${cdata(post.title)}</title><id>${escapeXml(url)}</id><link rel="alternate" href="${escapeXml(url)}"/><published>${new Date(post.published_at ?? post.created_at).toISOString()}</published><updated>${new Date(post.updated_at).toISOString()}</updated><summary type="html">${cdata(post.description)}</summary><category term="${escapeXml(post.tag)}"/><author><name>${escapeXml(creator.author)}</name>${email}<uri>${escapeXml(link)}</uri></author></entry>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeXml(link)}</id><title>${cdata(creator.title)}</title><subtitle>${cdata(creator.description)}</subtitle><updated>${new Date(updated).toISOString()}</updated><link rel="alternate" href="${escapeXml(link)}"/><link rel="self" href="${escapeXml(`${link}/feed.atom`)}"/><logo>${escapeXml(avatar)}</logo><icon>${escapeXml(avatar)}</icon><category term="${escapeXml(creator.category)}"/><rights>${new Date().getFullYear()} ${escapeXml(creator.author)}, All rights reserved.</rights><author><name>${escapeXml(creator.author)}</name>${email}<uri>${escapeXml(link)}</uri></author>${entries}</feed>`;
}

export function renderJsonFeed(creator: CreatorRow, posts: PostSummaryRow[]): string {
	const link = creatorUrl(creator.username);
	const avatar = avatarUrl(creator.username);
	const authors = [{ name: creator.author, url: link, avatar }];

	return JSON.stringify({
		version: "https://jsonfeed.org/version/1.1",
		title: creator.title,
		description: creator.description,
		home_page_url: link,
		feed_url: `${link}/feed.json`,
		icon: avatar,
		favicon: avatar,
		language: creator.language,
		authors,
		items: posts.map((post) => {
			const url = postUrl(creator.username, post.slug);
			return {
				id: url,
				url,
				title: post.title,
				summary: post.description,
				content_text: post.description,
				image: pictureUrl(creator.username, post.picture),
				banner_image: pictureUrl(creator.username, post.picture),
				date_published: new Date(post.published_at ?? post.created_at).toISOString(),
				date_modified: new Date(post.updated_at).toISOString(),
				tags: post.keywords
					.split(",")
					.map((k) => k.trim())
					.filter((k) => k.length > 0),
				language: post.language,
				authors,
			};
		}),
	});
}

export interface SitemapEntry {
	username: string;
	slug: string;
	updated_at: string;
}

export function renderSitemap(creators: { username: string; accessed_at: string }[], posts: SitemapEntry[]): string {
	const urls = [
		`<url><loc>${escapeXml(domain)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
		...creators.map(
			(creator) =>
				`<url><loc>${escapeXml(creatorUrl(creator.username))}</loc><lastmod>${escapeXml(creator.accessed_at.slice(0, 10))}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
		),
		...posts.map(
			(post) =>
				`<url><loc>${escapeXml(postUrl(post.username, post.slug))}</loc><lastmod>${escapeXml(post.updated_at.slice(0, 10))}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
		),
	].join("");

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function renderRobots(): string {
	return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /panel
Disallow: /metrics

Sitemap: ${domain}/sitemap.xml`;
}
