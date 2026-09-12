import { describe, expect, test } from "bun:test";
import { renderEmailHtml } from "../src/server/lib/email.ts";
import { panelTokenUrl } from "../src/server/lib/links.ts";

describe("transactional email HTML", () => {
	test("renders a branded responsive card with an action button", () => {
		const html = renderEmailHtml(
			{
				preview: "Confirm your email",
				label: "Welcome to Bloggy",
				title: "Confirm your email address",
				message: "Thanks for creating your account.",
				actionLabel: "Confirm email address",
				actionUrl: "https://bloggy.io/panel/confirm-email#token",
				notice: "This link expires in 24 hours.",
				safety: "You can ignore this message if you did not create an account.",
			},
			"Bloggy",
			"https://bloggy.io",
		);

		expect(html).toStartWith("<!doctype html>");
		expect(html).toContain('class="email-card"');
		expect(html).toContain("@media only screen and (max-width: 620px)");
		expect(html).toContain("background: #4f46e5");
		expect(html).toContain('href="https://bloggy.io/panel/confirm-email#token"');
		expect(html.match(/href="https:\/\/bloggy\.io\/panel\/confirm-email#token"/g)).toHaveLength(2);
		expect(html).toContain('href="https://bloggy.io"');
		expect(html).toContain('aria-label="Visit Bloggy"');
		expect(html.match(/href="https:\/\/bloggy\.io"/g)).toHaveLength(3);
		expect(html).toContain("Confirm email address");
		expect(html).toContain("If the button does not work");
	});

	test("keeps one-use tokens in URL fragments", () => {
		for (const route of ["confirm-email", "invite", "reset-password"] as const) {
			const token = "a".repeat(64);
			const url = new URL(panelTokenUrl(route, token));
			expect(url.pathname).toBe(`/panel/${route}`);
			expect(url.search).toBe("");
			expect(url.hash).toBe(`#${token}`);
		}
	});

	test("escapes every dynamic field", () => {
		const html = renderEmailHtml(
			{
				preview: "<preview>",
				label: "<label>",
				title: "<title>",
				message: "<script>alert(1)</script>",
				actionLabel: "<click>",
				actionUrl: 'https://example.com/?a=1&b="two"',
				notice: "<notice>",
				safety: "<safety>",
			},
			"<Bloggy>",
			"https://example.com/?a=1&b=2",
		);

		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).toContain("https://example.com/?a=1&amp;b=&quot;two&quot;");
		expect(html).toContain("&lt;Bloggy&gt;");
	});
});
