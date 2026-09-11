import { describe, expect, test } from "bun:test";
import type { CreatorRow } from "../src/server/db/creators.ts";
import { renderCreatorPage, renderMainPage } from "../src/server/ssr/pages.ts";

function creator(overrides: Partial<CreatorRow> = {}): CreatorRow {
	return {
		username: "alice",
		password: "hash",
		email: "alice@example.com",
		totp_secret: null,
		backup_codes: null,
		title: "Alice builds things",
		description: "Practical notes about software, teams, and thoughtful products.",
		author: "Alice Example",
		category: "Technology",
		language: "en",
		social: null,
		theme: "light",
		avatar_type: null,
		created_at: "2026-01-01T00:00:00.000Z",
		accessed_at: "2026-01-01T00:00:00.000Z",
		is_admin: 0,
		suspended_at: null,
		...overrides,
	};
}

describe("public homepage", () => {
	test("offers sign in and registration from the homepage", () => {
		const html = renderMainPage([creator()], ["Technology"]);
		expect(html).toContain('href="/panel">Sign in</a>');
		expect(html).toContain('href="/panel/register">Create account</a>');
		expect(html).toContain('href="/panel/register">Create your blog');
	});

	test("shows the creator's blog and panel instead when signed in", () => {
		const html = renderMainPage([creator()], ["Technology"], undefined, { username: "alice" });
		expect(html).toContain('href="/creator/alice">My blog</a>');
		expect(html).toContain('href="/panel">Open panel</a>');
		expect(html).toContain('href="/panel">Go to your panel');
		expect(html).not.toContain(">Sign in</a>");
		expect(html).not.toContain("Create account");
		expect(html).not.toContain("Create your blog");
	});

	test("renders shareable topic filters and marks the active topic", () => {
		const html = renderMainPage([creator()], ["Art and Design", "Technology"], "Technology");
		expect(html).toContain("/?topic=Art%20and%20Design");
		expect(html).toContain('class="topic-pill active" href="/?topic=Technology" aria-current="page"');
		expect(html).toContain("Technology blogs · Bloggy");
	});

	test("does not add account actions to creator pages", () => {
		const html = renderCreatorPage(creator(), []);
		expect(html).not.toContain('href="/panel"');
		expect(html).not.toContain('href="/panel/register"');
	});
});
