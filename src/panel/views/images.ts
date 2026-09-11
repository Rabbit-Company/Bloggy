import { api, type MediaItem } from "../api.ts";
import { instanceConfig } from "../constants.ts";
import { compressImage, confirm, el, formatBytes, formatDate, render, toast } from "../ui.ts";
import { copyText, imageMarkdown, previewImage } from "../image-picker.ts";

function tile(item: MediaItem, onChanged: () => void): HTMLElement {
	async function remove(): Promise<void> {
		const ok = await confirm({
			title: "Delete this image?",
			body: [el("p", {}, "Posts that reference it will show a broken image. This cannot be undone.")],
			confirmLabel: "Delete",
			danger: true,
		});
		if (!ok) return;

		try {
			await api.deleteImage(item.id);
			toast("Image deleted.", "success");
			onChanged();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not delete the image.", "error");
		}
	}

	function copyMarkdown(): void {
		void copyText(imageMarkdown(item), "Markdown copied. Paste it into your post.");
	}

	function copyId(): void {
		void copyText(item.id, "Image ID copied. Paste it into a post's cover field.");
	}

	// The thumbnail is cropped to fill the tile, so clicking it opens the image
	// at full size rather than doing nothing.
	const open = el(
		"button",
		{ type: "button", class: "tile-open", title: "View this image", "aria-label": "View this image at full size" },
		el("img", { src: item.url, alt: "", loading: "lazy" }),
	);
	open.addEventListener("click", () => previewImage(item, onChanged));

	return el(
		"figure",
		{ class: "image-tile", style: "margin:0" },
		open,
		el("button", { class: "button remove", onClick: () => void remove(), title: "Delete this image", "aria-label": "Delete this image" }, "×"),
		el(
			"figcaption",
			{ class: "info" },
			el("span", {}, `${formatBytes(item.size)} · ${formatDate(item.createdAt)}`),
			el(
				"span",
				{ class: "actions" },
				el("button", { class: "button small primary", onClick: copyMarkdown, title: `Copy ![](${item.url}) for a post body` }, "Copy Markdown"),
				el("button", { class: "button small ghost", onClick: copyId, title: "Copy the ID for a post's cover field" }, "ID"),
			),
		),
	);
}

function storageSummary(usage: number, limit: number): string {
	if (limit <= 0) return `${formatBytes(usage)} used`;
	return `${formatBytes(usage)} of ${formatBytes(limit)} used`;
}

export async function renderImages(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading your images…"));

	let images: MediaItem[];
	let usage = 0;
	let limit = 0;
	try {
		const result = await api.media();
		images = result.images;
		usage = result.usage;
		limit = result.limit;
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load your images."));
		return;
	}

	const reload = () => void renderImages(root);

	const fileInput = el("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
	const dropzone = el(
		"div",
		{ class: "dropzone", role: "button", tabindex: "0" },
		el("p", { style: "margin:0 0 .25rem;font-weight:600" }, "Drop images here, or click to choose"),
		el("p", { style: "margin:0;font-size:.85rem" }, "Resized and converted to WebP in your browser before upload."),
	);

	async function upload(files: FileList | File[]): Promise<void> {
		const list = [...files].filter((file) => file.type.startsWith("image/"));
		if (list.length === 0) return;

		let uploaded = 0;
		for (const file of list) {
			try {
				const blob = await compressImage(file, { maxWidth: 1600, maxBytes: instanceConfig().maxImageSize });
				await api.uploadImage(blob);
				uploaded++;
			} catch (err) {
				toast(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`, "error");
			}
		}

		if (uploaded > 0) {
			toast(uploaded === 1 ? "Image uploaded." : `${uploaded} images uploaded.`, "success");
			reload();
		}
	}

	dropzone.addEventListener("click", () => fileInput.click());
	dropzone.addEventListener("keydown", (event) => {
		if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") fileInput.click();
	});
	dropzone.addEventListener("dragover", (event) => {
		event.preventDefault();
		dropzone.classList.add("over");
	});
	dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
	dropzone.addEventListener("drop", (event) => {
		event.preventDefault();
		dropzone.classList.remove("over");
		const dropped = (event as DragEvent).dataTransfer?.files;
		if (dropped !== undefined) void upload(dropped);
	});
	fileInput.addEventListener("change", () => {
		if (fileInput.files !== null) void upload(fileInput.files);
		fileInput.value = "";
	});

	render(
		root,
		el(
			"div",
			{ class: "page-head" },
			el(
				"div",
				{},
				el("h1", {}, "Images"),
				el("p", {}, `${images.length} ${images.length === 1 ? "image" : "images"} · ${storageSummary(usage, limit)}`),
				el(
					"p",
					{ class: "hint" },
					"“Copy Markdown” gives you ",
					el("code", {}, "![](…)"),
					" to paste into a post body. “ID” gives the short identifier a post's cover field expects. From the editor you can insert images without coming here at all.",
				),
			),
		),
		dropzone,
		fileInput,
		images.length === 0
			? el("div", { class: "empty" }, "No images yet. Upload one to use as a post cover.")
			: el("div", { class: "image-grid" }, ...images.map((item) => tile(item, reload))),
	);
}
