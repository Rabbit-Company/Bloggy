export const BLOG_CSS = `
:root {
	--bg: #f9fafb;
	--surface: #ffffff;
	--text: #111827;
	--muted: #6b7280;
	--border: #e5e7eb;
	--accent: #4f46e5;
	--accent-hover: #4338ca;
	--code-bg: #f3f4f6;
	--scroll-track: #e4e4e4;
	--scroll-thumb: #b3b3b3;
	--scroll-thumb-hover: #999999;
	--shadow: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05);
	--radius: 12px;
	--font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	color-scheme: light;
}

[data-theme="dark"] {
	--bg: #0d1117;
	--surface: #161b22;
	--text: #e6edf3;
	--muted: #9198a1;
	--border: #30363d;
	--accent: #818cf8;
	--accent-hover: #a5b4fc;
	--code-bg: #1f2530;
	--scroll-track: #161b22;
	--scroll-thumb: #3d4451;
	--scroll-thumb-hover: #57606d;
	--shadow: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3);
	color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
	[data-theme="auto"] {
		--bg: #0d1117;
		--surface: #161b22;
		--text: #e6edf3;
		--muted: #9198a1;
		--border: #30363d;
		--accent: #818cf8;
		--accent-hover: #a5b4fc;
		--code-bg: #1f2530;
		--scroll-track: #161b22;
		--scroll-thumb: #3d4451;
		--scroll-thumb-hover: #57606d;
		--shadow: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3);
		color-scheme: dark;
	}
}

*, *::before, *::after { box-sizing: border-box; }

/* Always reserve the scrollbar's gutter. Without it a short page (a creator
   with few posts) has no scrollbar and a long one (a post) does, so every
   centred element jumps by half the scrollbar width when navigating between
   them. The fallback suits engines without scrollbar-gutter. */
html { scrollbar-gutter: stable; }
@supports not (scrollbar-gutter: stable) {
	html { overflow-y: scroll; }
}

/* Scrollbars. The standard properties cover Firefox and Chromium 121+; the
   -webkit- rules keep older WebKit/Blink in the same palette. */
* { scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) var(--scroll-track); }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--scroll-track); }
::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }
::-webkit-scrollbar-corner { background: var(--scroll-track); }

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-family: var(--font);
	font-size: 16px;
	line-height: 1.65;
	-webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

a.name:hover, a.tag:hover, .filter-note a:hover, footer a:hover { text-decoration: underline; }
.masthead h1 a:hover, .masthead h2 a:hover, .card h3 a:hover, .creators h3 a:hover { color: var(--accent); }

img { max-width: 100%; height: auto; }

.wrap { max-width: 80rem; margin: 0 auto; padding: 3rem 1.5rem; }
/* Applied to the post body only, never to the masthead above it, so a long
   blog title wraps identically on a creator page and on a post. */
.narrow { max-width: 56rem; margin-inline: auto; }

.masthead { text-align: center; margin-bottom: 1.5rem; }
.masthead h1, .masthead h2 { font-size: clamp(1.875rem, 3vw, 2.25rem); font-weight: 700; letter-spacing: -0.025em; margin: 0 0 0.5rem; }
.masthead h1 a, .masthead h2 a { color: inherit; }
.masthead p { color: var(--muted); font-size: 1.25rem; max-width: 42rem; margin: 0 auto; }

.social { display: flex; justify-content: center; gap: 1.25rem; margin-top: 0.5rem; }
.social a { color: var(--muted); display: inline-flex; }
.social a:hover { color: var(--text); }
.social svg { width: 1.5rem; height: 1.5rem; }

.search { display: block; width: 100%; max-width: 32rem; margin: 0 auto 1.5rem; padding: 0.7rem 1rem;
	font: inherit; font-size: 1.25rem; color: var(--text); background: var(--surface);
	border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
/* No detached outline ring. The border takes the accent colour instead,
   because a text field with no focus state at all leaves keyboard
   users unable to tell where they are. */
.search:focus { outline: none; border-color: var(--accent); }

.filter-note { text-align: center; color: var(--muted); margin: 0 0 1.5rem; }
.filter-note strong { color: var(--text); }

.grid { display: grid; gap: 1.75rem; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr)); }

.card { display: flex; flex-direction: column; overflow: hidden; background: var(--surface);
	border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
	transition: transform 0.15s ease; }
.card:hover { transform: translateY(-2px); }
.card img.cover { width: 100%; height: 12rem; object-fit: cover; }
.card .body { padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
.card .tag { align-self: flex-start; font-size: 0.875rem; font-weight: 600; color: var(--accent);
	text-transform: uppercase; letter-spacing: 0.04em; }
.card h3 { margin: 0; font-size: 1.25rem; line-height: 1.35; }
.card h3 a { color: var(--text); }
.card p { margin: 0; color: var(--muted); font-size: 1rem; }
.card .meta { margin-top: auto; padding-top: 0.75rem; display: flex; align-items: center; gap: 0.65rem;
	font-size: 0.875rem; color: var(--muted); }
.card .meta img { width: 2.5rem; height: 2.5rem; border-radius: 50%; display: block; }
.card .meta .dateline { display: block; }

.creators { list-style: none; padding: 0; margin: 0; display: grid; gap: 2rem;
	grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); text-align: center; }
.creators img { width: 10rem; height: 10rem; border-radius: 50%; box-shadow: var(--shadow); margin: 0 auto 0.75rem; display: block; }
.creators h3 { margin: 0; font-size: 1.125rem; }
.creators h3 a { color: var(--text); }
.creators p { margin: 0.15rem 0 0; font-size: 0.95rem; color: var(--muted); }

.byline { display: flex; align-items: center; gap: 0.75rem; margin: 1.5rem 0 2rem; color: var(--muted); font-size: 1rem; }
.byline img { width: 3rem; height: 3rem; border-radius: 50%; display: block; }

.name { display: block; color: var(--text); font-weight: 600; }

.more-wrap { text-align: center; margin-top: 2.5rem; }
.more { display: inline-block; padding: 0.7rem 1.5rem; border-radius: var(--radius);
	border: 1px solid var(--border); background: var(--surface); color: var(--text);
	font-weight: 600; box-shadow: var(--shadow); }
.more:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }

.empty { text-align: center; color: var(--muted); padding: 3rem 0; }

footer { border-top: 1px solid var(--border); margin-top: 4rem; padding: 2rem 0; text-align: center;
	color: var(--muted); font-size: 0.875rem; }

.post { font-size: 1.25rem; line-height: 1.65; }
.post h1 { font-size: clamp(1.9rem, 4vw, 2.6rem); line-height: 1.2; letter-spacing: -0.025em; margin: 0 0 0.5rem; }
.post h2 { font-size: 1.5em; margin: 2rem 0 0.7rem; line-height: 1.25; letter-spacing: -0.015em; }
.post h3 { font-size: 1.25em; margin: 1.75rem 0 0.5rem; line-height: 1.3; }
.post h4, .post h5, .post h6 { font-size: 1em; margin: 1.5rem 0 0.5rem; }
.post p { margin: 1em 0; }
.post ul, .post ol { margin: 1em 0; padding-left: 1.5em; }
.post li { margin: 0.5em 0; }
.post blockquote { margin: 1.5rem 0; padding: 0.5rem 1.25rem; border-left: 4px solid var(--accent);
	color: var(--muted); font-style: italic; }
.post img { border-radius: var(--radius); margin: 1.5rem 0; }
.post hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }
.post code { font-family: var(--font-mono); font-size: 0.9em; background: var(--code-bg);
	padding: 0.15em 0.4em; border-radius: 5px; }
.post pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius);
	padding: 1rem 1.25rem; overflow-x: auto; margin: 1.5rem 0; }
.post pre code { background: none; padding: 0; font-size: 0.9em; line-height: 1.55; }
.post table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; display: block; overflow-x: auto; }
.post th, .post td { border: 1px solid var(--border); padding: 0.55rem 0.85rem; text-align: left; }
.post th { background: var(--code-bg); font-weight: 600; }
/* Scoped to .content, the rendered markdown, so it never catches the byline
   links or the share button, which sit in the same article. */
.post .content a { text-decoration: underline; text-underline-offset: 2px; }

.post .task-list-item { list-style: none; }
.post .task-list-item-checkbox {
	width: auto; height: auto; margin: 0 0.5rem 0 0; padding: 0;
	vertical-align: baseline; accent-color: var(--accent);
}

.preview-banner {
	margin: 0 0 1.5rem;
	padding: 0.8rem 1rem;
	border: 1px solid var(--accent);
	border-radius: var(--radius);
	background: color-mix(in srgb, var(--accent) 10%, transparent);
	color: var(--text);
	font-size: 1rem;
	font-weight: 500;
}

.share { display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 2.5rem;
	padding: 0.75rem 1.5rem; border-radius: var(--radius); font-size: 1rem;
	background: var(--accent); color: #fff; font-weight: 600; }
.share:hover { background: var(--accent-hover); color: #fff; }
.share svg { width: 1.15rem; height: 1.15rem; }

.hidden { display: none !important; }

@media (prefers-reduced-motion: reduce) {
	* { animation: none !important; transition: none !important; }
}
`.trim();
