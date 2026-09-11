import { api, type Post } from "../api.ts";
import { getCreator } from "../session.ts";
import { confirm, el, formatDate, render, toast } from "../ui.ts";
import { navigate, panelUrl } from "../router.ts";

function publicUrl(username: string, slug: string): string {
	return `/creator/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
}

function postCard(post: Post, username: string, onDeleted: () => void): HTMLElement {
	const cover = post.picture.startsWith("http") ? post.picture : `/media/images/${username}/${post.picture}`;

	async function remove(): Promise<void> {
		const ok = await confirm({
			title: `Delete “${post.title}”?`,
			body: [el("p", {}, "This permanently removes the post and its view history. It cannot be undone.")],
			confirmLabel: "Delete post",
			danger: true,
		});
		if (!ok) return;

		try {
			await api.deletePost(post.slug);
			toast("Post deleted.", "success");
			onDeleted();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not delete the post.", "error");
		}
	}

	return el(
		"article",
		{ class: "post-card" },
		el("img", { src: cover, alt: "", loading: "lazy" }),
		el(
			"div",
			{ class: "body" },
			el(
				"div",
				{ class: "card-top" },
				el("span", { class: "tag" }, post.tag || "Untagged"),
				post.status === "draft" && el("span", { class: "badge draft" }, "Draft"),
			),
			el("h3", {}, post.title),
			el("p", { class: "desc" }, post.description),
			el(
				"div",
				{ class: "meta" },
				el("span", {}, post.status === "draft" ? `Saved ${formatDate(post.updatedAt)}` : formatDate(post.publishedAt ?? post.createdAt)),
				el("span", {}, "·"),
				el("span", {}, `${post.readTime} min read`),
				el("span", {}, "·"),
				el("span", {}, `${post.wordCount} words`),
			),
		),
		el(
			"div",
			{ class: "card-actions" },
			el("a", { class: "button small primary", href: panelUrl(`/editor/${encodeURIComponent(post.slug)}`) }, "Edit"),
			post.status === "draft"
				? el("a", { class: "button small ghost", href: `/preview/${encodeURIComponent(post.slug)}`, target: "_blank", rel: "noopener" }, "Preview")
				: el("a", { class: "button small ghost", href: publicUrl(username, post.slug), target: "_blank", rel: "noopener" }, "View"),
			el("button", { class: "button small danger", onClick: () => void remove() }, "Delete"),
		),
	);
}

export async function renderPosts(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading your posts…"));

	const username = getCreator()?.username ?? "";

	let posts: Post[];
	try {
		posts = (await api.posts()).posts;
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load your posts."));
		return;
	}

	const reload = () => void renderPosts(root);

	const published = posts.filter((post) => post.status === "published");
	const drafts = posts.filter((post) => post.status === "draft");

	const summary =
		drafts.length === 0
			? published.length === 1
				? "1 published post"
				: `${published.length} published posts`
			: `${published.length} published · ${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`;

	const head = el(
		"div",
		{ class: "page-head" },
		el("div", {}, el("h1", {}, "Posts"), el("p", {}, summary)),
		el(
			"div",
			{ class: "actions" },
			username.length > 0 &&
				el("a", { class: "button ghost", href: `/creator/${encodeURIComponent(username)}`, target: "_blank", rel: "noopener" }, "View blog"),
			el("a", { class: "button primary", href: panelUrl("/editor") }, "New post"),
		),
	);

	if (posts.length === 0) {
		render(
			root,
			head,
			el(
				"div",
				{ class: "empty" },
				el("p", {}, "You haven't published anything yet."),
				el("p", {}, el("a", { class: "button primary", href: panelUrl("/editor") }, "Write your first post")),
			),
		);
		return;
	}

	render(
		root,
		head,
		drafts.length > 0 && el("h2", { class: "section-heading" }, "Drafts"),
		drafts.length > 0 && el("div", { class: "grid" }, ...drafts.map((post) => postCard(post, username, reload))),
		drafts.length > 0 && published.length > 0 && el("h2", { class: "section-heading" }, "Published"),
		published.length > 0 && el("div", { class: "grid" }, ...published.map((post) => postCard(post, username, reload))),
	);
}

export function newPost(): void {
	navigate("/editor");
}
