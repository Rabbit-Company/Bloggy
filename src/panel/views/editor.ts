import { api, type Post, type PostInput } from "../api.ts";
import { CATEGORIES, LANGUAGES, POST_MAX_WORDS, POST_MIN_WORDS, instanceConfig } from "../constants.ts";
import { getCreator } from "../session.ts";
import { compressImage, confirm, el, render, setHtml, slugify, toast } from "../ui.ts";
import { navigate, panelUrl } from "../router.ts";
import type { PostStatus } from "../../shared/constants.ts";
import { imageMarkdown, pickImage } from "../image-picker.ts";
import { createMarkdownToolbar, installShortcuts } from "../markdown-editor.ts";

const PREVIEW_DELAY = 400;

function select(name: string, options: readonly (string | { value: string; label: string })[], selected?: string): HTMLSelectElement {
	const node = el("select", { name, id: name });
	for (const option of options) {
		const value = typeof option === "string" ? option : option.value;
		const label = typeof option === "string" ? option : option.label;
		node.append(el("option", { value, selected: value === selected }, label));
	}
	return node;
}

function labelled(label: string, control: HTMLElement, help?: string): HTMLElement {
	return el("label", { class: "field", for: control.id }, el("span", {}, label), control, help !== undefined && el("span", { class: "help" }, help));
}

export async function renderEditor(root: HTMLElement, params: Record<string, string>): Promise<void> {
	const editingSlug = params.slug;
	const isEdit = typeof editingSlug === "string" && editingSlug.length > 0;
	const creator = getCreator();
	const canPublish = creator?.membership?.canPublish ?? true;

	let existing: Post | null = null;
	if (isEdit) {
		render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading post…"));
		try {
			existing = (await api.post(editingSlug)).post;
		} catch (err) {
			render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load that post."));
			return;
		}
		if (existing.status === "published" && creator?.membership && !creator.membership.canPublish) {
			render(
				root,
				el(
					"div",
					{ class: "empty" },
					el("p", {}, "Published posts are read-only for your role."),
					el("a", { class: "button primary", href: `/creator/${encodeURIComponent(creator.username)}/${encodeURIComponent(existing.slug)}` }, "View post"),
				),
			);
			return;
		}
	}

	const title = el("input", { id: "title", maxlength: "100", placeholder: "A memorable title" });
	const slug = el("input", { id: "slug", maxlength: "100", placeholder: "a-memorable-title", spellcheck: "false" });
	const description = el("textarea", { id: "description", maxlength: "300", rows: "3" });
	const picture = el("input", { id: "picture", maxlength: "500", placeholder: "https://… or an uploaded image id" });
	const tag = el("input", { id: "tag", maxlength: "30", placeholder: "Tutorial" });
	const keywords = el("input", { id: "keywords", maxlength: "255", placeholder: "bun, sql, blogging" });
	const category = select("category", CATEGORIES, existing?.category ?? creator?.category ?? "Technology");
	const language = select("language", LANGUAGES, existing?.language ?? creator?.language ?? "en");
	const markdown = el("textarea", { id: "markdown", class: "code", spellcheck: "true" });

	if (existing !== null) {
		title.value = existing.title;
		slug.value = existing.slug;
		description.value = existing.description;
		picture.value = existing.picture;
		tag.value = existing.tag;
		keywords.value = existing.keywords.join(", ");
		markdown.value = existing.markdown;
		// The slug is part of every published URL, so changing it would break
		// existing links. Create a new post instead.
		slug.disabled = true;
	}

	title.addEventListener("input", () => {
		if (!isEdit && slug.dataset.touched !== "true") slug.value = slugify(title.value);
	});
	slug.addEventListener("input", () => {
		slug.dataset.touched = "true";
	});

	const preview = el("div", { class: "preview" });
	const counter = el("span", { class: "counter" }, "0 words");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight = false;

	function schedulePreview(): void {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (inFlight) return;
			const source = markdown.value;

			if (source.trim().length === 0) {
				setHtml(preview, "");
				preview.append(el("p", { style: "color:var(--muted)" }, "Your rendered post will appear here."));
				counter.textContent = "0 words";
				counter.classList.remove("over");
				return;
			}

			inFlight = true;
			try {
				const result = await api.preview(source);
				setHtml(preview, result.html);
				counter.textContent = `${result.wordCount} words · ${result.readTime} min read`;
				counter.classList.toggle("over", result.wordCount < POST_MIN_WORDS || result.wordCount > POST_MAX_WORDS);
			} catch {
				counter.textContent = "Preview unavailable";
			} finally {
				inFlight = false;
			}
		}, PREVIEW_DELAY);
	}

	markdown.addEventListener("input", schedulePreview);

	installShortcuts(markdown, schedulePreview);

	markdown.addEventListener("keydown", (event) => {
		if (event.key !== "Tab") return;
		event.preventDefault();
		// execCommand keeps the browser's undo stack, while assigning value drops it.
		if (!document.execCommand("insertText", false, "\t")) {
			const start = markdown.selectionStart;
			markdown.setRangeText("\t", start, markdown.selectionEnd, "end");
		}
		schedulePreview();
	});

	const fileInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
	fileInput.addEventListener("change", async () => {
		const file = fileInput.files?.[0];
		if (file === undefined) return;

		try {
			const blob = await compressImage(file, { maxWidth: 1600, maxBytes: instanceConfig().maxImageSize });
			const item = await api.uploadImage(blob);
			picture.value = item.id;
			toast("Cover image uploaded.", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Upload failed.", "error");
		} finally {
			fileInput.value = "";
		}
	});

	function insertAtCursor(text: string): void {
		markdown.focus();
		const start = markdown.selectionStart;
		const end = markdown.selectionEnd;

		// execCommand keeps the native undo stack, while setRangeText does not.
		if (!document.execCommand("insertText", false, text)) {
			markdown.value = `${markdown.value.slice(0, start)}${text}${markdown.value.slice(end)}`;
			markdown.selectionStart = markdown.selectionEnd = start + text.length;
		}

		schedulePreview();
	}

	async function insertImage(): Promise<void> {
		const item = await pickImage("markdown");
		if (item === null) return;

		const selected = markdown.value.slice(markdown.selectionStart, markdown.selectionEnd).trim();
		insertAtCursor(imageMarkdown(item, selected));
		toast("Image inserted.", "success");
	}

	async function chooseCover(): Promise<void> {
		const item = await pickImage("cover");
		if (item === null) return;
		picture.value = item.id;
		toast("Cover image set.", "success");
	}

	const startedPublished = existing?.status === "published";
	const isReview = existing?.status === "review";
	const hasChangesRequested = existing?.status === "changes";

	const saveDraft = el(
		"button",
		{ class: "button ghost" },
		canPublish && isReview ? "Request changes" : startedPublished ? "Unpublish" : hasChangesRequested ? "Save changes" : "Save draft",
	);
	const save = el(
		"button",
		{ class: "button primary" },
		canPublish ? (startedPublished ? "Save changes" : "Publish") : hasChangesRequested ? "Resubmit for review" : "Submit for review",
	);

	async function submit(status: PostStatus): Promise<void> {
		const input: PostInput = {
			slug: (isEdit ? (existing?.slug ?? "") : slug.value.trim()).toLowerCase(),
			title: title.value.trim(),
			description: description.value.trim(),
			picture: picture.value.trim(),
			markdown: markdown.value,
			category: category.value,
			language: language.value,
			tag: tag.value.trim(),
			keywords: keywords.value
				.split(",")
				.map((k) => k.trim())
				.filter((k) => k.length > 0)
				.join(","),
			status,
		};

		save.disabled = true;
		saveDraft.disabled = true;
		try {
			if (isEdit) await api.updatePost(input);
			else await api.createPost(input);

			const message =
				status === "review"
					? "Post submitted for review."
					: status === "draft" || status === "changes"
						? startedPublished
							? "Post unpublished. It is now a draft."
							: "Work saved."
						: isEdit
							? "Changes saved."
							: "Post published.";
			toast(message, "success");
			navigate("/posts");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not save the post.", "error");
		} finally {
			save.disabled = false;
			saveDraft.disabled = false;
		}
	}

	async function requestChanges(): Promise<void> {
		if (existing === null) return;
		const note = el("textarea", { rows: "4", maxlength: "500", placeholder: "Explain what should be revised…" });
		const approved = await confirm({
			title: "Request changes",
			body: [el("p", {}, "Your note will appear beside the post for the writer."), note],
			confirmLabel: "Send back to writer",
		});
		if (!approved) return;
		if (note.value.trim().length === 0) {
			toast("Add a note explaining the requested changes.", "error");
			return;
		}
		try {
			await api.requestChanges(existing.slug, note.value.trim());
			toast("Changes requested.", "success");
			navigate("/posts");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not request changes.", "error");
		}
	}

	save.addEventListener("click", () => void submit(canPublish ? "published" : "review"));
	saveDraft.addEventListener("click", () => {
		if (canPublish && isReview) void requestChanges();
		else void submit(hasChangesRequested ? "changes" : "draft");
	});

	const onKey = (event: KeyboardEvent) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			// Ctrl+S never changes what the public can see: it keeps a draft a
			// draft, and saves edits to an already published post in place.
			void submit(startedPublished && canPublish ? "published" : hasChangesRequested ? "changes" : existing?.status === "review" ? "review" : "draft");
		}
	};
	document.addEventListener("keydown", onKey);
	// The router replaces the outlet's children on navigation, so drop the global
	// listener when that happens so it does not outlive this screen.
	new MutationObserver((_records, observer) => {
		if (!root.contains(markdown)) {
			document.removeEventListener("keydown", onKey);
			observer.disconnect();
		}
	}).observe(root, { childList: true });

	render(
		root,
		el(
			"div",
			{ class: "page-head" },
			el(
				"div",
				{},
				el(
					"h1",
					{},
					isEdit ? "Edit post" : "New post",
					existing !== null &&
						el(
							"span",
							{ class: `badge ${existing.status}` },
							{ draft: "Draft", review: "In review", changes: "Changes requested", published: "Published" }[existing.status],
						),
				),
				el("p", {}, isEdit ? `Editing /${existing?.slug ?? ""}` : "Write in Markdown. The preview is rendered by the server."),
			),
			el(
				"div",
				{ class: "actions" },
				counter,
				isEdit &&
					el("a", { class: "button ghost", href: `/preview/${encodeURIComponent(existing?.slug ?? "")}`, target: "_blank", rel: "noopener" }, "Preview"),
				el("a", { class: "button ghost", href: panelUrl("/posts") }, "Cancel"),
				saveDraft,
				save,
			),
		),
		existing?.status === "changes" &&
			existing.reviewNote.length > 0 &&
			el("div", { class: "review-banner" }, el("strong", {}, "Reviewer requested changes"), el("p", {}, existing.reviewNote)),

		el(
			"div",
			{ class: "card" },
			el(
				"div",
				{ class: "row" },
				labelled("Title", title, "5 to 100 characters."),
				labelled("URL slug", slug, isEdit ? "Fixed once published." : "Lowercase letters, numbers and hyphens."),
			),
			labelled("Description", description, "30 to 300 characters. Shown in listings and link previews."),
			el(
				"div",
				{ class: "row" },
				labelled("Tag", tag, "3 to 30 characters."),
				labelled("Keywords", keywords, "3 to 20, comma separated."),
				labelled("Category", category),
				labelled("Language", language),
			),
			el(
				"div",
				{},
				labelled("Cover image", picture, "An uploaded image id, or a full URL."),
				el(
					"div",
					{ class: "actions" },
					el("button", { class: "button ghost small", onClick: () => fileInput.click() }, "Upload new"),
					el("button", { class: "button ghost small", onClick: () => void chooseCover() }, "Choose existing"),
					fileInput,
				),
			),
		),

		el(
			"div",
			{ class: "editor-split" },
			el(
				"div",
				{},
				el("label", { class: "md-label", for: "markdown" }, "Markdown"),
				createMarkdownToolbar(markdown, { onChange: schedulePreview, onInsertImage: () => void insertImage() }),
				markdown,
			),
			el("div", {}, el("span", { class: "field" }, el("span", {}, "Preview")), preview),
		),
	);

	schedulePreview();
	if (!isEdit) title.focus();
}
