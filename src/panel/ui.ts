import { imageHasAnimation } from "../shared/image-formats.ts";

type Attributes = Record<string, string | number | boolean | EventListener | undefined>;
export type Child = Node | string | null | undefined | false;

/**
 * Attribute values are set with `setAttribute` and children are appended as
 * text nodes, so nothing here can inject markup. User data reaches the DOM as
 * text unless it is explicitly passed through {@link setHtml}.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);

	for (const [name, value] of Object.entries(attributes)) {
		if (value === undefined || value === false) continue;

		if (name.startsWith("on") && typeof value === "function") {
			node.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
		} else if (value === true) {
			node.setAttribute(name, "");
		} else {
			node.setAttribute(name, String(value));
		}
	}

	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		node.append(typeof child === "string" ? document.createTextNode(child) : child);
	}

	return node;
}

export function render(target: HTMLElement, ...children: Child[]): void {
	target.replaceChildren();
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		target.append(typeof child === "string" ? document.createTextNode(child) : child);
	}
}

/**
 * The only caller is the editor preview, whose HTML comes from the backend's
 * markdown renderer and has already been sanitized there.
 */
export function setHtml(target: HTMLElement, html: string): void {
	target.innerHTML = html;
}

export function $(selector: string, scope: ParentNode = document): HTMLElement | null {
	return scope.querySelector(selector);
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "success" | "error" | "info" = "info", timeout = 5000): void {
	if (toastHost === null) {
		toastHost = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
		document.body.append(toastHost);
	}

	const node = el("div", { class: `toast toast-${kind}` }, message);
	toastHost.append(node);

	setTimeout(() => {
		node.classList.add("leaving");
		setTimeout(() => node.remove(), 200);
	}, timeout);
}

export interface ConfirmOptions {
	title: string;
	body?: Child[];
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

export function modal(options: ConfirmOptions): Promise<Record<string, string> | null> {
	return new Promise((resolve) => {
		const form = el("form", { method: "dialog", class: "modal-form" }, ...(options.body ?? []));

		const dialog = el(
			"dialog",
			{ class: "modal" },
			el("h2", {}, options.title),
			form,
			el(
				"div",
				{ class: "modal-actions" },
				el("button", { type: "button", class: "button ghost", onClick: () => close(null) }, options.cancelLabel ?? "Cancel"),
				el(
					"button",
					{ type: "button", class: `button ${options.danger === true ? "danger" : "primary"}`, onClick: () => submit() },
					options.confirmLabel ?? "Confirm",
				),
			),
		);

		function collect(): Record<string, string> {
			const values: Record<string, string> = {};
			for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea, select")) {
				if (field.name.length > 0) values[field.name] = field.value;
			}
			return values;
		}

		function submit(): void {
			close(collect());
		}

		function close(result: Record<string, string> | null): void {
			dialog.close();
			dialog.remove();
			resolve(result);
		}

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			submit();
		});

		dialog.addEventListener("cancel", (event) => {
			event.preventDefault();
			close(null);
		});

		document.body.append(dialog);
		dialog.showModal();
		form.querySelector<HTMLInputElement>("input, textarea")?.focus();
	});
}

export async function confirm(options: ConfirmOptions): Promise<boolean> {
	return (await modal(options)) !== null;
}

/**
 * A dialog with no form and no confirm/cancel pair, for content that is read
 * rather than filled in. Closes on Escape, on a backdrop click and on demand,
 * and hands the caller a `close` it can wire to its own buttons.
 */
export function sheet(build: (close: () => void) => Child[], className = ""): void {
	let dialog!: HTMLDialogElement;

	const close = (): void => {
		dialog.close();
		dialog.remove();
	};

	dialog = el("dialog", { class: `modal sheet ${className}`.trim() }, ...build(close));

	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		close();
	});

	// A click landing on the dialog itself rather than its contents is a click
	// on the backdrop, which the native element does not report separately.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});

	document.body.append(dialog);
	dialog.showModal();
}

export function field(label: string, name: string, type = "text", placeholder = ""): HTMLElement {
	return el(
		"label",
		{ class: "field" },
		el("span", {}, label),
		el("input", { name, type, placeholder, autocomplete: type === "password" ? "current-password" : "off" }),
	);
}

export function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}

export function pagination(total: number, limit: number, offset: number, onOffset: (offset: number) => void): HTMLElement | false {
	if (total <= limit && offset === 0) return false;
	const start = total === 0 ? 0 : offset + 1;
	const end = Math.min(total, offset + limit);
	const previous = el("button", { class: "button small ghost", disabled: offset <= 0 }, "Previous");
	const next = el("button", { class: "button small ghost", disabled: offset + limit >= total }, "Next");
	previous.addEventListener("click", () => onOffset(Math.max(0, offset - limit)));
	next.addEventListener("click", () => onOffset(offset + limit));
	return el(
		"nav",
		{ class: "pagination", "aria-label": "Pagination" },
		el("span", {}, `${start} to ${end} of ${total}`),
		el("div", { class: "actions" }, previous, next),
	);
}

export function slugify(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^([^a-z])/, "post-$1")
		.slice(0, 100);
}

export interface CompressOptions {
	maxWidth: number;
	maxBytes: number;
	type?: string;
}

/**
 * Replaces the `browser-image-compression` dependency the old panel used:
 * `createImageBitmap` plus a canvas does the same job natively. Quality is
 * stepped down until the result fits the size limit, so an upload never fails
 * for being a few kilobytes over.
 */
export async function compressImage(file: File, options: CompressOptions): Promise<Blob> {
	if (file.type === "image/svg+xml") {
		if (file.size > options.maxBytes) throw new Error("This SVG is too large. Please choose a smaller file.");
		return file;
	}
	if (["image/gif", "image/apng", "image/avif", "image/avif-sequence"].includes(file.type)) {
		if (file.size > options.maxBytes) throw new Error("This image is too large. Animated images must fit the upload limit without compression.");
		return file;
	}
	if (["image/png", "image/webp"].includes(file.type) && imageHasAnimation(file.type, new Uint8Array(await file.arrayBuffer()))) {
		if (file.size > options.maxBytes) throw new Error("This image is too large. Animated images must fit the upload limit without compression.");
		return file;
	}

	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, options.maxWidth / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext("2d");
	if (context === null) throw new Error("Could not process the image in this browser.");
	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const type = options.type ?? "image/webp";

	for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
		if (blob !== null && blob.size <= options.maxBytes) return blob;
	}

	throw new Error("This image is too large even after compression. Please choose a smaller one.");
}
