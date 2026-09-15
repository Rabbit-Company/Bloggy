import { beforeAll, describe, expect, test } from "bun:test";
import { createSession } from "../src/server/auth/sessions.ts";
import { insertCreator } from "../src/server/db/creators.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import type { CreatorRow } from "../src/server/db/creators.ts";
import type { PostRow } from "../src/server/db/posts.ts";
import { renderTemplate, sanitizeTemplate, validateCustomization } from "../src/server/lib/customization.ts";
import { renderCreatorPage, renderPostPage } from "../src/server/ssr/pages.ts";
import { HOME_STARTER_TEMPLATE, POST_STARTER_TEMPLATE } from "../src/shared/customization.ts";
import { createApp } from "../src/server/index.ts";

const OWNER = "custom-owner";

beforeAll(async () => {
	await migrate();
	await sql`DELETE FROM creator_customizations WHERE username = ${OWNER}`;
	await sql`DELETE FROM sessions WHERE username = ${OWNER}`;
	await sql`DELETE FROM creators WHERE username = ${OWNER}`;
	await insertCreator({
		username: OWNER,
		password: "unused",
		email: "custom@example.com",
		title: "Customized publication",
		description: "A publication used to verify safe and flexible custom layouts.",
		author: "Custom Owner",
		category: "Technology",
		language: "en",
		theme: "light",
	});
});

async function ownerRequest(path: string, token: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	if (typeof init.body === "string") headers.set("Content-Type", "application/json");
	return createApp().handle(new Request(`http://localhost:3000${path}`, { ...init, headers }));
}

function creator(overrides: Partial<CreatorRow> = {}): CreatorRow {
	return {
		username: "alice",
		password: "hash",
		email: "alice@example.com",
		email_verified_at: "2026-01-01T00:00:00.000Z",
		totp_secret: null,
		backup_codes: null,
		title: "Alice builds things",
		description: "Practical notes about software, teams, and thoughtful products.",
		author: "Alice Example",
		category: "Technology",
		language: "en",
		social: null,
		theme: "light",
		theme_colors: null,
		avatar_type: null,
		created_at: "2026-01-01T00:00:00.000Z",
		accessed_at: "2026-01-01T00:00:00.000Z",
		is_admin: 0,
		suspended_at: null,
		...overrides,
	};
}

const post: PostRow = {
	username: "alice",
	slug: "first-post",
	title: "A carefully customized post",
	description: "A detailed description for the customized example blog post.",
	picture: "00000000-0000-4000-8000-000000000001",
	markdown: "This is **safe** post content.",
	category: "Technology",
	language: "en",
	tag: "Design",
	keywords: "custom, theme, design",
	word_count: 200,
	read_time: 1,
	status: "published",
	created_at: "2026-01-01T00:00:00.000Z",
	published_at: "2026-01-02T00:00:00.000Z",
	updated_at: "2026-01-02T00:00:00.000Z",
	created_by: "alice",
	updated_by: "alice",
	review_note: "",
};

describe("advanced template safety", () => {
	test("accepts and renders the starter components", () => {
		const home = sanitizeTemplate("home", HOME_STARTER_TEMPLATE);
		const html = renderTemplate(home, { "bloggy-posts": '<div class="posts">Published posts</div>' });
		expect(html).toContain('<div class="posts">Published posts</div>');
		expect(html).not.toContain("bloggy-posts");
	});

	test("requires the dynamic content component exactly once", () => {
		expect(() => sanitizeTemplate("home", "<main>Nothing here</main>")).toThrow("must contain exactly one");
		expect(() => sanitizeTemplate("post", "<bloggy-post-content></bloggy-post-content><bloggy-post-content></bloggy-post-content>")).toThrow(
			"must contain exactly one",
		);
	});

	test("rejects executable and interactive markup", () => {
		for (const template of [
			"<script>alert(1)</script><bloggy-posts></bloggy-posts>",
			'<img src="/x" onerror="alert(1)"><bloggy-posts></bloggy-posts>',
			'<a href="javascript:alert(1)">click</a><bloggy-posts></bloggy-posts>',
			'<form action="/api/v1/creators/me"><bloggy-posts></bloggy-posts></form>',
		]) {
			expect(() => sanitizeTemplate("home", template)).toThrow();
		}
	});

	test("enforces customization size limits", () => {
		expect(() => validateCustomization({ customCss: "x".repeat(50_001), homeTemplate: HOME_STARTER_TEMPLATE, postTemplate: POST_STARTER_TEMPLATE })).toThrow(
			"cannot be larger",
		);
	});
});

describe("custom public pages", () => {
	test("applies a custom palette and custom home layout", () => {
		const html = renderCreatorPage(creator({ theme: "custom", theme_colors: '{"background":"#010203","accent":"#abcdef"}' }), [], {}, undefined, {
			customCss: ".custom-home { max-width: 60rem; }",
			homeTemplate: '<main class="custom-home"><h1>My layout</h1><bloggy-posts></bloggy-posts></main>',
			postTemplate: "",
			updatedAt: null,
		});
		expect(html).toContain('data-theme="custom"');
		expect(html).toContain("--bg: #010203");
		expect(html).toContain("--accent: #abcdef");
		expect(html).toContain("<h1>My layout</h1>");
		expect(html).toContain("No posts yet.");
	});

	test("keeps custom font imports at the top of their own stylesheet", () => {
		const customCss =
			'@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap");\nbody { font-family: "Press Start 2P", sans-serif; }';
		const customization = { customCss, homeTemplate: "", postTemplate: "", updatedAt: null };
		const themedCreator = creator({ theme: "custom" });
		for (const html of [renderCreatorPage(themedCreator, [], {}, undefined, customization), renderPostPage(themedCreator, post, {}, customization)]) {
			const themeStyle = html.indexOf("<style data-creator-theme>");
			const customStyle = html.indexOf("<style data-creator-custom>");
			expect(themeStyle).toBeGreaterThan(-1);
			expect(customStyle).toBeGreaterThan(themeStyle);
			expect(html.slice(customStyle).startsWith(`<style data-creator-custom>${customCss}`)).toBe(true);
		}
	});

	test("renders post data through a custom post template", () => {
		const html = renderPostPage(
			creator(),
			post,
			{},
			{
				customCss: "",
				homeTemplate: "",
				postTemplate: '<main class="magazine"><bloggy-post-title></bloggy-post-title><bloggy-post-content></bloggy-post-content></main>',
				updatedAt: null,
			},
		);
		expect(html).toContain('<main class="magazine">');
		expect(html).toContain("A carefully customized post");
		expect(html).toContain("<strong>safe</strong>");
		expect(html).not.toContain("bloggy-post-content");
	});

	test("cannot break out of the custom style element", () => {
		const html = renderCreatorPage(creator(), [], {}, undefined, {
			customCss: "</style><script>alert(1)</script>",
			homeTemplate: "",
			postTemplate: "",
			updatedAt: null,
		});
		expect(html).not.toContain("</style><script>alert(1)</script>");
		expect(html).toContain("<\\/style><script>alert(1)</script>");
	});
});

describe("customization API", () => {
	test("lets only the owner save templates and renders them publicly", async () => {
		const { token } = await createSession(OWNER);
		const denied = await createApp().handle(new Request("http://localhost:3000/api/v1/creators/me/customization"));
		expect(denied.status).toBe(401);

		const saved = await ownerRequest("/api/v1/creators/me/customization", token, {
			method: "POST",
			body: JSON.stringify({
				customCss: ".custom-layout { letter-spacing: .01em; }",
				homeTemplate: '<main class="custom-layout"><h1>Distinctive home</h1><bloggy-posts></bloggy-posts></main>',
				postTemplate: POST_STARTER_TEMPLATE,
			}),
		});
		expect(saved.status).toBe(200);

		const publicPage = await createApp().handle(new Request(`http://localhost:3000/creator/${OWNER}`));
		const html = await publicPage.text();
		expect(html).toContain("Distinctive home");
		expect(html).toContain("letter-spacing: .01em");

		const updated = await ownerRequest("/api/v1/creators/me/customization", token, {
			method: "POST",
			body: JSON.stringify({
				customCss: ".updated-layout { max-width: 70rem; }",
				homeTemplate: '<main class="updated-layout"><h1>Updated home</h1><bloggy-posts></bloggy-posts></main>',
				postTemplate: POST_STARTER_TEMPLATE,
			}),
		});
		expect(updated.status).toBe(200);

		const updatedPage = await createApp().handle(new Request(`http://localhost:3000/creator/${OWNER}`));
		const updatedHtml = await updatedPage.text();
		expect(updatedHtml).toContain("Updated home");
		expect(updatedHtml).toContain("max-width: 70rem");
		expect(updatedHtml).not.toContain("Distinctive home");
	});
});
