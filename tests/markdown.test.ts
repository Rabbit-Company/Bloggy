import { describe, expect, test } from "bun:test";
import { escapeHtml, escapeJson, excerpt, isSafeUrl, renderMarkdown } from "../src/server/ssr/markdown.ts";

const TAB = String.fromCharCode(9);

function liveTags(html: string): string[] {
	return html.match(/<[a-zA-Z][^>]*>/g) ?? [];
}

function isDangerous(html: string): boolean {
	return liveTags(html).some((tag) => /^<(script|iframe|svg|object|embed)\b/i.test(tag) || /\son\w+\s*=/i.test(tag) || /javascript:/i.test(tag));
}

describe("isSafeUrl", () => {
	test.each([
		["https://example.com", true],
		["http://example.com", true],
		["mailto:someone@example.com", true],
		["/relative/path", true],
		["#fragment", true],
		["./image.png", true],
		["foo/bar:baz", true],
	])("allows %s", (url, expected) => {
		expect(isSafeUrl(url as string)).toBe(expected as boolean);
	});

	test.each([
		["javascript:alert(1)", false],
		["JaVaScRiPt:alert(1)", false],
		["  javascript:alert(1)", false],
		[`java${TAB}script:alert(1)`, false],
		["java&#x09;script:alert(1)", false],
		["&#106;avascript:alert(1)", false],
		["data:text/html,<script>alert(1)</script>", false],
		["vbscript:msgbox(1)", false],
		["", false],
	])("rejects %s", (url, expected) => {
		expect(isSafeUrl(url as string)).toBe(expected as boolean);
	});
});

describe("renderMarkdown", () => {
	test.each([
		"<script>alert(1)</script>",
		"<img src=x onerror=alert(1)>",
		'<a href="javascript:alert(1)">x</a>',
		"[x](javascript:alert(1))",
		"[x](JAVASCRIPT:alert(1))",
		"![x](javascript:alert(1))",
		"[x](java&#x09;script:alert(1))",
		"<svg/onload=alert(1)>",
		'<iframe src="javascript:alert(1)">',
		"[x](data:text/html,<script>alert(1)</script>)",
		'<div onmouseover="alert(1)">hover</div>',
		"[x](  javascript:alert(1))",
		`[x](${TAB}javascript:alert(1))`,
	])("neutralizes %s", (payload) => {
		expect(isDangerous(renderMarkdown(payload))).toBe(false);
	});

	test("escapes raw HTML rather than dropping it", () => {
		expect(renderMarkdown("<b>hi</b>")).toContain("&lt;b&gt;");
	});

	test("renders GFM: headings with ids, emphasis, lists, code", () => {
		const html = renderMarkdown("# Title\n\n**bold**\n\n- a\n- b\n\n```js\nconst x=1;\n```\n");
		expect(html).toContain('<h1 id="title">Title</h1>');
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<li>a</li>");
		expect(html).toContain('class="language-js"');
	});

	test("renders GFM tables and strikethrough", () => {
		const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n");
		expect(html).toContain("<table>");
		expect(html).toContain("<del>gone</del>");
	});

	test("marks external links as untrusted user content", () => {
		const html = renderMarkdown("[x](https://example.com)");
		expect(html).toContain('rel="ugc nofollow noopener noreferrer"');
		expect(html).toContain('target="_blank"');
	});

	test("leaves relative links unmarked", () => {
		expect(renderMarkdown("[x](/about)")).not.toContain("noopener");
	});
});

describe("escaping helpers", () => {
	test("escapeHtml covers every metacharacter", () => {
		expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
	});

	test("escapeJson prevents breaking out of a script block", () => {
		expect(escapeJson({ a: "</script>" })).not.toContain("</script>");
	});

	test("excerpt strips markup and truncates", () => {
		expect(excerpt("# Head\n\nSome [link](https://x.com) text", 200)).toBe("Head Some link text");
		expect(excerpt("a".repeat(300), 50)).toHaveLength(50);
	});
});
