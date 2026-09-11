import { api, type MediaItem } from "./api.ts";
import { instanceConfig } from "./constants.ts";
import { compressImage, confirm, el, formatBytes, formatDateTime, sheet, toast } from "./ui.ts";

export function imageMarkdown(item: MediaItem, alt = ""): string {
	return `![${alt}](${item.url})`;
}

/**
 * `navigator.clipboard` needs a secure context, so it is missing when a panel
 * is reached over plain HTTP on something other than localhost. The fallback
 * is the old selection trick, and if even that fails the text is shown so it
 * can be copied by hand rather than silently lost.
 */
export async function copyText(text: string, success: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		toast(success, "success");
		return;
	} catch {
		// Fall through to the legacy path.
	}

	try {
		const scratch = el("textarea", {
			style: "position:fixed;top:-1000px;left:-1000px;opacity:0",
			"aria-hidden": "true",
		});
		scratch.value = text;
		document.body.append(scratch);
		scratch.select();
		const copied = document.execCommand("copy");
		scratch.remove();

		if (copied) {
			toast(success, "success");
			return;
		}
	} catch {
		// Fall through to showing the value.
	}

	toast(`Copy this manually: ${text}`, "info", 15000);
}

function detailRow(label: string, value: string): HTMLElement {
	return el("div", { class: "detail" }, el("dt", {}, label), el("dd", {}, value));
}

/**
 * Shows one image at full size with its details.
 *
 * A tile only ever shows a cropped thumbnail, so this is the only place to see
 * what was actually uploaded. Dimensions are read off the loaded image rather
 * than stored: the browser knows them once it has the file, and recording them
 * would mean a migration for something only ever displayed.
 */
export function previewImage(item: MediaItem, onDeleted?: () => void): void {
	const dimensions = el("dd", {}, "Loading…");

	const image = el("img", { src: item.url, alt: "" });
	image.addEventListener("load", () => {
		dimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
	});
	image.addEventListener("error", () => {
		dimensions.textContent = "Unavailable";
	});

	sheet((close) => {
		const remove = el("button", { type: "button", class: "button quiet danger" }, "Delete");
		remove.addEventListener("click", async () => {
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
				close();
				onDeleted?.();
			} catch (err) {
				toast(err instanceof Error ? err.message : "Could not delete the image.", "error");
			}
		});

		return [
			el("div", { class: "preview-stage" }, image),
			el(
				"div",
				{ class: "preview-meta" },
				el(
					"dl",
					{ class: "details" },
					el("div", { class: "detail" }, el("dt", {}, "Dimensions"), dimensions),
					detailRow("Size", formatBytes(item.size)),
					detailRow("Type", item.contentType),
					detailRow("Uploaded", formatDateTime(item.createdAt)),
					detailRow("ID", item.id),
				),
				el(
					"div",
					{ class: "preview-actions" },
					el(
						"button",
						{ type: "button", class: "button quiet primary", onClick: () => void copyText(imageMarkdown(item), "Markdown copied. Paste it into your post.") },
						"Copy Markdown",
					),
					el(
						"button",
						{ type: "button", class: "button quiet", onClick: () => void copyText(item.id, "Image ID copied. Paste it into a post's cover field.") },
						"Copy ID",
					),
					el("button", { type: "button", class: "button quiet", onClick: () => void copyText(item.url, "Image URL copied.") }, "Copy URL"),
					onDeleted !== undefined && remove,
					el("button", { type: "button", class: "button ghost", onClick: close }, "Close"),
				),
			),
		];
	}, "preview");
}

export type PickMode = "markdown" | "cover";

export function pickImage(mode: PickMode): Promise<MediaItem | null> {
	return new Promise((resolve) => {
		const grid = el("div", { class: "image-grid picker-grid" });
		const status = el("p", { class: "hint" }, "Loading your images…");

		const fileInput = el("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
		const uploadButton = el("button", { type: "button", class: "button ghost" }, "Upload new");
		uploadButton.addEventListener("click", () => fileInput.click());

		const dialog = el(
			"dialog",
			{ class: "modal wide" },
			el("h2", {}, mode === "cover" ? "Choose a cover image" : "Insert an image"),
			status,
			grid,
			el(
				"div",
				{ class: "modal-actions" },
				uploadButton,
				fileInput,
				el("button", { type: "button", class: "button ghost", onClick: () => close(null) }, "Cancel"),
			),
		);

		function close(result: MediaItem | null): void {
			dialog.close();
			dialog.remove();
			resolve(result);
		}

		async function load(): Promise<void> {
			try {
				const { images } = await api.media();

				if (images.length === 0) {
					status.textContent = "No images yet. Upload one to get started.";
					grid.replaceChildren();
					return;
				}

				status.textContent = mode === "cover" ? "Click an image to use it as this post's cover." : "Click an image to insert it at the cursor.";

				grid.replaceChildren(
					...images.map((item) =>
						el(
							"button",
							{
								type: "button",
								class: "image-tile picker-item",
								title: `${formatBytes(item.size)}, click to ${mode === "cover" ? "use as cover" : "insert"}`,
								onClick: () => close(item),
							},
							el("img", { src: item.url, alt: "", loading: "lazy" }),
						),
					),
				);
			} catch (err) {
				status.textContent = err instanceof Error ? err.message : "Could not load your images.";
			}
		}

		fileInput.addEventListener("change", async () => {
			const files = [...(fileInput.files ?? [])].filter((file) => file.type.startsWith("image/"));
			fileInput.value = "";
			if (files.length === 0) return;

			uploadButton.disabled = true;
			status.textContent = "Uploading…";

			let last: MediaItem | null = null;
			for (const file of files) {
				try {
					const blob = await compressImage(file, { maxWidth: 1600, maxBytes: instanceConfig().maxImageSize });
					last = await api.uploadImage(blob);
				} catch (err) {
					toast(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`, "error");
				}
			}

			uploadButton.disabled = false;

			if (last !== null && files.length === 1) {
				close(last);
				return;
			}

			await load();
		});

		dialog.addEventListener("cancel", (event) => {
			event.preventDefault();
			close(null);
		});

		document.body.append(dialog);
		dialog.showModal();
		void load();
	});
}
