import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createSession } from "../src/server/auth/sessions.ts";
import { insertCreator } from "../src/server/db/creators.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { insertPost } from "../src/server/db/posts.ts";
import { invalidateCreator } from "../src/server/middleware/cache.ts";
import { createApp } from "../src/server/index.ts";
import { DEFAULT_EMBED_CUSTOMIZATION, formatEmbedDate } from "../src/shared/embed.ts";
import { BLOG_CSS } from "../src/server/ssr/styles.ts";

const USER = "embed-owner";
const SLUG = "first-story";
const BASE = `/creator/${USER}/_embed`;

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	await sql`DELETE FROM creator_embeds WHERE username = ${USER}`;
	await sql`DELETE FROM sessions WHERE username = ${USER}`;
	await sql`DELETE FROM posts WHERE username = ${USER}`;
	await sql`DELETE FROM creators WHERE username = ${USER}`;
	await insertCreator({
		username: USER,
		password: "unused",
		email: "embed@example.com",
		title: "Embedded journal",
		description: "The description belongs to the ordinary blog and can be hidden in embeds.",
		author: "Embedded Author",
		category: "Technology",
		language: "en",
		theme: "light",
	});
	await insertPost(
		USER,
		{
			slug: SLUG,
			title: "A public embedded story",
			description: "A description for the card that can be hidden in the iframe view.",
			picture: "00000000-0000-4000-8000-000000000001",
			markdown: "This story is public and appears in the embedded post view.",
			category: "Technology",
			language: "en",
			tag: "Community",
			keywords: "public,embed,story",
			status: "published",
		},
		12,
		1,
	);
	await insertPost(
		USER,
		{
			slug: "private-draft",
			title: "A private draft story",
			description: "This draft description should not be visible through an iframe.",
			picture: "00000000-0000-4000-8000-000000000002",
			markdown: "This draft must not be published through the embed route.",
			category: "Technology",
			language: "en",
			tag: "Community",
			keywords: "private,draft,story",
			status: "draft",
		},
		12,
		1,
	);
	invalidateCreator(USER);
});

function get(path: string): Promise<Response> {
	return createApp().handle(new Request(`http://localhost:3000${path}`));
}

async function ownerRequest(path: string, token: string, body?: unknown): Promise<Response> {
	return createApp().handle(
		new Request(`http://localhost:3000${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

describe("public iframe views", () => {
	test("shows only published posts by default and is frameable but not indexable", async () => {
		const response = await get(BASE);
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get("X-Frame-Options")).toBeNull();
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		expect(html).toContain("data-embed");
		expect(html).toContain('<meta name="robots" content="noindex">');
		expect(html).toContain(`href="${BASE}/${SLUG}"`);
		expect(html).toContain('data-posts-per-row="0"');
		expect(BLOG_CSS).toContain('.embed-card h2 a::after { position: absolute; inset: 0; content: ""; }');
		expect(html).not.toContain("private-draft");
		expect(html).not.toContain("Embedded Author");
		expect(html).not.toContain('class="search-form"');
		expect(html).not.toContain('class="embed-header"');
		expect(html).not.toContain('class="embed-meta"');
		expect(html).not.toContain("A description for the card that can be hidden in the iframe view.");
		const panel = await get("/panel");
		expect(panel.headers.get("X-Frame-Options")).toBe("DENY");
	});

	test("keeps posts and the back button inside the iframe", async () => {
		const response = await get(`${BASE}/${SLUG}`);
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(html).toContain(`class="embed-back" href="${BASE}"`);
		expect(html).toContain("This story is public and appears in the embedded post view.");
		expect(html).not.toContain('class="byline"');
		expect(html).not.toContain('class="embed-byline"');
		expect(html).not.toContain('class="embed-share"');
		expect((await get(`${BASE}/private-draft`)).status).toBe(404);
	});

	test("has regular pagination links without needing scripts", async () => {
		for (let index = 2; index <= 13; index++) {
			await insertPost(
				USER,
				{
					slug: `story-${index}`,
					title: `Public story ${index}`,
					description: "A public description for pagination testing in iframe views.",
					picture: "00000000-0000-4000-8000-000000000001",
					markdown: "Enough content to verify that this post appears in the iframe listing.",
					category: "Technology",
					language: "en",
					tag: "Community",
					keywords: "pagination,embed,public",
					status: "published",
				},
				12,
				1,
			);
		}
		invalidateCreator(USER);
		const first = await (await get(BASE)).text();
		const second = await (await get(`${BASE}?page=2`)).text();
		expect(first).toContain(`rel="next" href="${BASE}?page=2"`);
		expect(second).toContain(`rel="prev" href="${BASE}"`);
		expect(first).not.toContain("/assets/blog.js");
	});
});

describe("embed customization API", () => {
	test("lets the owner customize only the embed and invalidates its cached page", async () => {
		const { token } = await createSession(USER);
		await sql`UPDATE creators SET social = ${JSON.stringify({ website: "https://example.com" })} WHERE username = ${USER}`;
		const denied = await get("/api/v1/creators/me/embed");
		expect(denied.status).toBe(401);
		const initial = await ownerRequest("/api/v1/creators/me/embed", token);
		expect(initial.status).toBe(200);
		expect((await initial.json()).data).toMatchObject(DEFAULT_EMBED_CUSTOMIZATION);
		await get(BASE);
		const customCss = '@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap");\n.embed-card { border: 0; }';
		const saved = await ownerRequest("/api/v1/creators/me/embed", token, {
			...DEFAULT_EMBED_CUSTOMIZATION,
			showTitle: true,
			showDescription: true,
			showAuthor: true,
			showDate: true,
			showReadTime: true,
			showSearch: true,
			showSocial: true,
			showPostDescriptions: true,
			showShare: true,
			customCss,
		});
		expect(saved.status).toBe(200);
		const embed = await (await get(BASE)).text();
		expect(embed).toContain('class="embed-header"');
		expect(embed).toContain("Embedded Author");
		expect(embed).toMatch(/class="embed-meta"[^>]*>.*<time datetime="[^"]+">[^<]+<\/time>/);
		expect(embed).toContain('class="embed-read-time">1 min read</span>');
		expect(embed).toContain('class="search-form"');
		expect(embed).toContain("The description belongs to the ordinary blog");
		expect(embed).toContain("A description for the card that can be hidden in the iframe view.");
		expect(embed).toContain('href="https://example.com"');
		expect(embed).toContain(`<style data-creator-custom>${customCss}`);
		const embeddedPost = await (await get(`${BASE}/${SLUG}`)).text();
		expect(embeddedPost).toContain('class="embed-byline"');
		expect(embeddedPost).toContain('class="embed-read-time">1 min read</span>');
		expect(embeddedPost).toContain('class="embed-share"');
		const regular = await (await get(`/creator/${USER}`)).text();
		expect(regular).not.toContain(".embed-card { border: 0; }");
		expect((await ownerRequest("/api/v1/creators/me/embed", token, DEFAULT_EMBED_CUSTOMIZATION)).status).toBe(200);
		const restored = await (await get(BASE)).text();
		expect(restored).not.toContain('class="embed-header"');
		expect(restored).not.toContain(customCss);
	});

	test("lets date and read time be displayed independently of the author", async () => {
		const { token } = await createSession(USER);
		const dateOnly = await ownerRequest("/api/v1/creators/me/embed", token, {
			...DEFAULT_EMBED_CUSTOMIZATION,
			showDate: true,
		});
		expect(dateOnly.status).toBe(200);
		const cards = await (await get(BASE)).text();
		expect(cards).toContain('class="embed-meta"');
		expect(cards).toContain('<time datetime="');
		expect(cards).not.toContain('class="embed-read-time"');
		expect(cards).not.toContain("Embedded Author");
		const post = await (await get(`${BASE}/${SLUG}`)).text();
		expect(post).toContain('class="embed-byline"');
		expect(post).toContain('<time datetime="');
		expect(post).not.toContain('class="embed-read-time"');
		const readTimeOnly = await ownerRequest("/api/v1/creators/me/embed", token, {
			...DEFAULT_EMBED_CUSTOMIZATION,
			showReadTime: true,
		});
		expect(readTimeOnly.status).toBe(200);
		const updatedCards = await (await get(BASE)).text();
		expect(updatedCards).toContain('class="embed-read-time">1 min read</span>');
		expect(updatedCards).not.toContain('<time datetime="');
	});

	test("saves the chosen date format and renders it on cards and posts", async () => {
		const { token } = await createSession(USER);
		const publishedAt = "2026-04-29T00:00:00.000Z";
		await sql`UPDATE posts SET published_at = ${publishedAt} WHERE username = ${USER} AND slug = ${SLUG}`;
		invalidateCreator(USER);
		const saved = await ownerRequest("/api/v1/creators/me/embed", token, {
			...DEFAULT_EMBED_CUSTOMIZATION,
			showDate: true,
			dateFormat: "ordinal",
		});
		expect(saved.status).toBe(200);
		expect((await saved.json()).data.dateFormat).toBe("ordinal");
		const stored = await ownerRequest("/api/v1/creators/me/embed", token);
		expect((await stored.json()).data.dateFormat).toBe("ordinal");
		for (const path of [BASE, `${BASE}/${SLUG}`]) {
			const html = await (await get(path)).text();
			expect(html).toContain(`<time datetime="${publishedAt}">April 29th 2026</time>`);
		}
	});

	test("saves a maximum posts-per-row value and restores Auto", async () => {
		const { token } = await createSession(USER);
		const saved = await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, postsPerRow: 8 });
		expect(saved.status).toBe(200);
		expect((await saved.json()).data.postsPerRow).toBe(8);
		const stored = await ownerRequest("/api/v1/creators/me/embed", token);
		expect((await stored.json()).data.postsPerRow).toBe(8);
		const html = await (await get(BASE)).text();
		expect(html).toContain('class="embed-wrap" data-posts-per-row="8" style="--embed-wrap-max-width:256rem"');
		expect(html).toContain('data-posts-per-row="8" style="--embed-column-share:12.500000%"');
		expect(BLOG_CSS).toContain('html[data-embed] .embed-grid[data-posts-per-row]:not([data-posts-per-row="0"])');
		expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, postsPerRow: 1 })).status).toBe(200);
		const singleColumn = await (await get(BASE)).text();
		expect(singleColumn).toContain('class="embed-wrap" data-posts-per-row="1" style="--embed-wrap-max-width:32rem"');
		expect(singleColumn).toContain('data-posts-per-row="1" style="--embed-column-share:100.000000%"');
		expect((await ownerRequest("/api/v1/creators/me/embed", token, DEFAULT_EMBED_CUSTOMIZATION)).status).toBe(200);
		const automatic = await (await get(BASE)).text();
		expect(automatic).toContain('data-posts-per-row="0"');
		expect(automatic).not.toContain("--embed-wrap-max-width:");
		expect(automatic).not.toContain("--embed-column-share:");
	});

	test("formats every preset and ordinal edge days", () => {
		const date = "2026-04-29T00:00:00.000Z";
		expect(formatEmbedDate(date, "iso")).toBe("2026-04-29");
		expect(formatEmbedDate(date, "short")).toBe("Apr 29, 2026");
		expect(formatEmbedDate(date, "long")).toBe("April 29, 2026");
		expect(formatEmbedDate(date, "day-first")).toBe("29 April 2026");
		expect(formatEmbedDate(date, "ordinal")).toBe("April 29th 2026");
		for (const [day, suffix] of [
			[1, "st"],
			[2, "nd"],
			[3, "rd"],
			[11, "th"],
			[12, "th"],
			[13, "th"],
			[21, "st"],
			[22, "nd"],
			[23, "rd"],
		] as const) {
			expect(formatEmbedDate(`2026-04-${String(day).padStart(2, "0")}`, "ordinal")).toBe(`April ${day}${suffix} 2026`);
		}
	});

	test("rejects invalid options and oversized CSS", async () => {
		const { token } = await createSession(USER);
		expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, showSearch: "yes" })).status).toBe(400);
		expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, showReadTime: "yes" })).status).toBe(400);
		expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, dateFormat: "relative" })).status).toBe(400);
		for (const postsPerRow of [-1, 1.5, 101, "8", null]) {
			expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, postsPerRow })).status).toBe(400);
		}
		expect((await ownerRequest("/api/v1/creators/me/embed", token, { ...DEFAULT_EMBED_CUSTOMIZATION, customCss: "x".repeat(50_001) })).status).toBe(400);
	});
});
