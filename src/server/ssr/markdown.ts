/**
 * Post bodies are untrusted input, so rendering has to be safe by construction:
 *
 *  1. `noHtmlBlocks` and `noHtmlSpans` make Bun's parser escape every raw HTML
 *     block and span to entities, which removes `<script>`, event-handler
 *     attributes and every other tag-injection route.
 *  2. Because of (1), the only `href`/`src` attributes in the output are ones
 *     Bun generated from markdown link and image syntax. Those still carry
 *     whatever URL the author typed, including `javascript:`, so the generated
 *     attributes are rewritten here to allow only safe schemes.
 *
 * `Bun.markdown.render()` is deliberately not used: supplying a partial
 * callback set disables default rendering for every element without a callback
 * (headings, paragraphs and emphasis are dropped, and raw HTML stops being
 * escaped), so it would mean reimplementing and re-securing the whole renderer.
 */

const PARSER_OPTIONS: Bun.markdown.Options = {
	tables: true,
	strikethrough: true,
	tasklists: true,
	autolinks: true,
	headings: { ids: true },
	noHtmlBlocks: true,
	noHtmlSpans: true,
};

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&");
}

/**
 * Relative URLs and fragments are allowed. Absolute URLs must use a scheme
 * from {@link SAFE_SCHEMES}. Anything else, such as `javascript:`, `data:` or
 * `vbscript:`, is rejected. Entities and embedded whitespace are stripped
 * first, since `java&#x09;script:` and `java\tscript:` are both live in browsers.
 */
export function isSafeUrl(raw: string): boolean {
	const normalized = decodeEntities(raw)
		.replace(/[\u0000-\u0020\u007f]/g, "")
		.toLowerCase();

	if (normalized.length === 0) return false;
	if (normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("?") || normalized.startsWith(".")) return true;

	const colon = normalized.indexOf(":");
	if (colon === -1) return true;

	// A slash before the colon means the colon is inside a path segment, not a
	// scheme separator, as in "foo/bar:baz".
	const slash = normalized.indexOf("/");
	if (slash !== -1 && slash < colon) return true;

	return SAFE_SCHEMES.has(normalized.slice(0, colon));
}

const ATTRIBUTE = /(<(?:a|img)\b[^>]*?\s(?:href|src)=)"([^"]*)"/gi;

/**
 * Safe to do with a regex only because step (1) above guarantees no
 * author-controlled tags survive: every `<a>` and `<img>` here was emitted by
 * the parser, in a known shape.
 */
function sanitizeUrls(html: string): string {
	return html.replace(ATTRIBUTE, (_match, prefix: string, url: string) => `${prefix}"${isSafeUrl(url) ? url : "#"}"`);
}

function markExternalLinks(html: string): string {
	return html.replace(/<a\b([^>]*?)href="(https?:\/\/[^"]*)"([^>]*)>/gi, (_match, before: string, href: string, after: string) => {
		return `<a${before}href="${href}"${after} target="_blank" rel="ugc nofollow noopener noreferrer">`;
	});
}

export function renderMarkdown(markdown: string): string {
	return markExternalLinks(sanitizeUrls(Bun.markdown.html(markdown, PARSER_OPTIONS)));
}

export function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escapeXml(value: string): string {
	return escapeHtml(value);
}

/**
 * JSON.stringify alone is not enough: a literal `</script>` inside a string
 * value would end the block early.
 */
export function escapeJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function excerpt(markdown: string, length = 160): string {
	const text = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (text.length <= length) return text;
	return `${text.slice(0, length - 1).trimEnd()}…`;
}
