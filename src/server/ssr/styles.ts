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

.search { display: block; width: 100%; margin: 0 auto 1.5rem; padding: 0.7rem 1rem;
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

/* The public directory has its own chrome. Keeping every selector under the
   home classes means an author's page remains entirely their own. */
.home-wrap { max-width: 80rem; margin: 0 auto; padding: 0 1.5rem 3rem; }

.home-header { min-height: 5.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; }
.home-brand { display: inline-flex; align-items: center; gap: 0.7rem; color: var(--text); font-size: 1.2rem; font-weight: 750;
	letter-spacing: -0.025em; }
.home-brand:hover { color: var(--text); }
.home-brand img { display: block; width: 2.25rem; height: 2.25rem; }
.home-account, .hero-actions { display: flex; align-items: center; gap: 0.75rem; }
.home-login { padding: 0.55rem 0.75rem; color: var(--text); font-weight: 600; }
.home-login:hover { color: var(--accent); }
.home-button { min-height: 2.85rem; padding: 0.68rem 1.15rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
	border: 1px solid transparent; border-radius: 0.75rem; font-weight: 700; line-height: 1.2; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
.home-button:hover { transform: translateY(-1px); }
.home-button.compact { min-height: 2.5rem; padding: 0.55rem 0.9rem; background: var(--text); color: var(--bg); }
.home-button.compact:hover { color: var(--bg); box-shadow: 0 8px 20px rgb(0 0 0 / 0.15); }
.home-button.primary { background: var(--accent); color: #fff; box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 25%, transparent); }
.home-button.primary:hover { background: var(--accent-hover); color: #fff; }
.home-button.secondary { border-color: var(--border); background: var(--surface); color: var(--text); }
.home-button.secondary:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--accent); box-shadow: var(--shadow); }

.home-hero { position: relative; isolation: isolate; min-height: 31rem; margin-top: 0.75rem; padding: clamp(3rem, 7vw, 3rem);
	display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 0.65fr); align-items: center; gap: 3rem;
	overflow: hidden; border: 1px solid var(--border); border-radius: 1.75rem;
	background: radial-gradient(circle at 88% 18%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 30%),
		linear-gradient(145deg, var(--surface), color-mix(in srgb, var(--accent) 6%, var(--surface))); box-shadow: var(--shadow); }
.home-hero::before { content: ""; position: absolute; z-index: -1; left: -5rem; bottom: -8rem; width: 18rem; height: 18rem;
	border-radius: 50%; background: color-mix(in srgb, var(--accent) 7%, transparent); filter: blur(2px); }
.hero-copy { position: relative; z-index: 2; }
.hero-eyebrow, .section-kicker { display: block; margin-bottom: 0.8rem; color: var(--accent); font-size: 0.78rem; font-weight: 800;
	letter-spacing: 0.12em; text-transform: uppercase; }
.hero-copy h1 { max-width: 48rem; margin: 0; font-size: clamp(2.5rem, 5vw, 4.65rem); line-height: 1.02; letter-spacing: -0.055em; }
.hero-copy h1 span { color: var(--accent); }
.hero-copy > p { max-width: 40rem; margin: 1.4rem 0 1.75rem; color: var(--muted); font-size: clamp(1.05rem, 1.6vw, 1.22rem); line-height: 1.65; }
.hero-mark { position: relative; min-height: 18rem; display: grid; place-items: center; }
.hero-logo { position: relative; z-index: 2; width: 10rem; height: 10rem; padding: 0.9rem; display: grid; place-items: center;
	border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border)); border-radius: 2.25rem;
	background: color-mix(in srgb, var(--surface) 82%, transparent); box-shadow: 0 30px 70px color-mix(in srgb, var(--accent) 22%, transparent);
	transform: rotate(-5deg); backdrop-filter: blur(10px); }
.hero-logo img { width: 100%; height: 100%; }
.hero-orbit { position: absolute; border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); border-radius: 50%; }
.hero-orbit::after { content: ""; position: absolute; width: 0.65rem; height: 0.65rem; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 12%, transparent); }
.hero-orbit.one { width: 15rem; height: 15rem; transform: rotate(25deg); }
.hero-orbit.one::after { top: 1.2rem; right: 2.4rem; }
.hero-orbit.two { width: 21rem; height: 21rem; opacity: 0.55; transform: rotate(-38deg); }
.hero-orbit.two::after { bottom: 2.1rem; left: 3.5rem; }

.creator-directory { padding-top: clamp(3.5rem, 7vw, 6rem); scroll-margin-top: 1rem; }
.topic-filter { margin-bottom: 2rem; }
.topic-filter-heading { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.35rem; }
.section-kicker { margin-bottom: 0.3rem; }
.topic-filter h2 { margin: 0; font-size: clamp(1.65rem, 3vw, 2.25rem); line-height: 1.2; letter-spacing: -0.035em; }
.clear-topic { flex: none; color: var(--muted); font-size: 0.9rem; font-weight: 650; }
.clear-topic:hover { color: var(--accent); text-decoration: underline; }
.topic-pills { display: flex; gap: 0.55rem; overflow-x: auto; padding: 0.2rem 0 0.65rem; scrollbar-width: thin; }
.topic-pill { flex: none; padding: 0.5rem 0.85rem; border: 1px solid var(--border); border-radius: 999px; background: var(--surface);
	color: var(--muted); font-size: 0.9rem; font-weight: 650; line-height: 1.3; }
.topic-pill:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); color: var(--accent); }
.topic-pill.active { border-color: var(--accent); background: var(--accent); color: #fff; box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 20%, transparent); }
.topic-pill.active:hover { color: #fff; }

.creator-directory .creators { grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 1rem; text-align: left; }
.creator-card { min-width: 0; padding: 1.25rem; display: flex; align-items: flex-start; gap: 1rem; border: 1px solid var(--border);
	border-radius: 1rem; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.03); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
.creator-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); box-shadow: var(--shadow); }
.creator-card .creator-avatar { flex: none; }
.creator-card .creator-avatar img { width: 4.5rem; height: 4.5rem; margin: 0; border-radius: 1rem; object-fit: cover; box-shadow: none; }
.creator-card-body { min-width: 0; }
.creator-card .creator-topic { display: inline-block; margin-bottom: 0.35rem; color: var(--accent); font-size: 0.72rem; font-weight: 800;
	letter-spacing: 0.075em; line-height: 1.25; text-transform: uppercase; }
.creator-card .creator-topic:hover { text-decoration: underline; }
.creator-card h3 { margin: 0; font-size: 1.08rem; line-height: 1.3; }
.creator-card p { margin: 0.15rem 0 0.65rem; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.creator-card .view-blog { color: var(--text); font-size: 0.86rem; font-weight: 700; }
.creator-card .view-blog span { display: inline-block; transition: transform 0.15s ease; }
.creator-card:hover .view-blog span { transform: translateX(3px); }
.creator-card .view-blog:hover { color: var(--accent); }
.directory-empty { padding: 3.5rem 1.5rem; border: 1px dashed var(--border); border-radius: 1rem; text-align: center; color: var(--muted); }
.directory-empty p { margin: 0; }
.directory-empty a { display: inline-block; margin-top: 0.55rem; font-weight: 700; }
.home-social { margin-top: 3rem; }
.home-social .social { margin-top: 0; }

.home-button:focus-visible, .home-login:focus-visible, .home-brand:focus-visible, .topic-pill:focus-visible,
.creator-card a:focus-visible, .clear-topic:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 42%, transparent); outline-offset: 3px; }

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

/* The framed view has its own layout. Every selector is scoped so the regular
   creator and post pages keep their existing appearance. */
html[data-embed] { --bg: transparent; --surface: transparent; --shadow: none; }
.embed-wrap { width: 100%; max-width: 80rem; margin-inline: auto; padding: 1rem; }
html[data-embed] .embed-wrap[data-posts-per-row] { max-width: var(--embed-wrap-max-width); }
.embed-header { margin-bottom: 1.25rem; }
.embed-header h1 { margin: 0; font-size: clamp(1.4rem, 4vw, 2rem); line-height: 1.2; }
.embed-header p { margin: 0.25rem 0 0; color: var(--muted); }
.embed-header .social { justify-content: flex-start; }
.embed-wrap .search { margin-bottom: 1.25rem; font-size: 1rem; }
.embed-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 1rem; }
html[data-embed] .embed-grid[data-posts-per-row]:not([data-posts-per-row="0"]) { grid-template-columns: repeat(auto-fill, minmax(min(100%, max(16rem, calc(var(--embed-column-share) - 2rem))), 1fr)); }
.embed-card { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); cursor: pointer; }
.embed-card:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.embed-cover { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.embed-card-body { padding: 0.9rem; }
.embed-card h2 { margin: 0; font-size: 1.08rem; line-height: 1.35; }
.embed-card h2 a { color: var(--text); }
/* The title link fills its card without changing the markup custom CSS targets. */
.embed-card h2 a::after { position: absolute; inset: 0; content: ""; }
.embed-card p { margin: 0.5rem 0 0; color: var(--muted); font-size: 0.92rem; }
.embed-meta, .embed-byline { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.4rem; color: var(--muted); font-size: 0.85rem; }
.embed-meta { margin-top: 0.6rem; }
.embed-author { color: inherit; }
.embed-meta-separator { color: var(--muted); }
.embed-empty { margin: 2rem 0; color: var(--muted); text-align: center; }
.embed-pagination { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1.25rem; }
.embed-pagination a { padding: 0.45rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); }
.embed-pagination a[rel="next"] { margin-left: auto; }
.embed-back { display: inline-block; margin-bottom: 1.25rem; font-weight: 650; }
.embed-post { max-width: 56rem; margin-inline: auto; font-size: 1.05rem; }
.embed-post h1 { margin-bottom: 1rem; }
.embed-byline { margin-bottom: 1rem; font-size: 0.9rem; }
.embed-share { display: inline-block; margin-top: 1.5rem; }

@media (max-width: 767px) {
	.embed-grid { grid-template-columns: 1fr; }
	html[data-embed] .embed-grid[data-posts-per-row]:not([data-posts-per-row="0"]) { grid-template-columns: 1fr; }
}

.hidden { display: none !important; }

@media (prefers-reduced-motion: reduce) {
	* { animation: none !important; transition: none !important; }
}

@media (max-width: 760px) {
	.home-header { min-height: 4.75rem; }
	.home-hero { min-height: auto; padding: 3rem 1.5rem; grid-template-columns: 1fr; }
	.hero-mark { display: none; }
	.hero-copy h1 { font-size: clamp(2.45rem, 12vw, 3.65rem); }
	.topic-filter-heading { align-items: flex-end; }
}

@media (max-width: 480px) {
	.home-wrap { padding-inline: 1rem; }
	.home-brand img { width: 2rem; height: 2rem; }
	.home-account { gap: 0.15rem; }
	.home-button.compact { padding-inline: 0.7rem; font-size: 0.88rem; }
	.home-login { padding-inline: 0.55rem; font-size: 0.9rem; }
	.home-hero { margin-top: 0.25rem; border-radius: 1.25rem; }
	.hero-actions { align-items: stretch; flex-direction: column; }
	.topic-filter-heading { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
	.creator-directory .creators { grid-template-columns: 1fr; }
	.creator-card { padding: 1rem; }
}
`.trim();
