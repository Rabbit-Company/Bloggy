import { el } from "./ui.ts";

/**
 * Every command goes through {@link replaceRange}, which uses
 * `document.execCommand("insertText")` so the browser's native undo stack
 * stays intact. A plain `value =` assignment would silently throw away the
 * author's undo history.
 *
 * Commands are toggles wherever markdown allows it: pressing Bold on already
 * bold text unwraps it, and pressing H2 on an H2 line clears the heading.
 */

/**
 * `setRangeText` is the fallback for browsers where `execCommand` is gone. It
 * works but loses undo, which is why it is not the first choice.
 */
function replaceRange(area: HTMLTextAreaElement, start: number, end: number, text: string, selectStart: number, selectEnd: number): void {
	area.focus();
	area.setSelectionRange(start, end);

	if (!document.execCommand("insertText", false, text)) {
		area.setRangeText(text, start, end, "end");
	}

	area.setSelectionRange(selectStart, selectEnd);
}

function toggleWrap(area: HTMLTextAreaElement, marker: string, placeholder: string): void {
	const value = area.value;
	const start = area.selectionStart;
	const end = area.selectionEnd;
	const selected = value.slice(start, end);
	const width = marker.length;

	if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
		const inner = selected.slice(width, -width);
		replaceRange(area, start, end, inner, start, start + inner.length);
		return;
	}

	if (start >= width && value.slice(start - width, start) === marker && value.slice(end, end + width) === marker) {
		replaceRange(area, start - width, end + width, selected, start - width, start - width + selected.length);
		return;
	}

	if (selected.length === 0) {
		const text = `${marker}${placeholder}${marker}`;
		replaceRange(area, start, end, text, start + width, start + width + placeholder.length);
		return;
	}

	const text = `${marker}${selected}${marker}`;
	replaceRange(area, start, end, text, start + width, start + width + selected.length);
}

function transformLines(area: HTMLTextAreaElement, transform: (lines: string[]) => string[]): void {
	const value = area.value;
	const start = value.lastIndexOf("\n", area.selectionStart - 1) + 1;

	let end = value.indexOf("\n", area.selectionEnd);
	if (end === -1) end = value.length;

	const replacement = transform(value.slice(start, end).split("\n")).join("\n");
	replaceRange(area, start, end, replacement, start, start + replacement.length);
}

function bareLine(line: string): string {
	return line
		.replace(/^#{1,6}\s+/, "")
		.replace(/^>\s?/, "")
		.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
		.replace(/^\s*[-*+]\s+/, "")
		.replace(/^\s*\d+\.\s+/, "");
}

function togglePrefix(area: HTMLTextAreaElement, matches: (line: string) => boolean, build: (line: string, index: number) => string): void {
	transformLines(area, (lines) => {
		const meaningful = lines.filter((line) => line.trim().length > 0);
		const allPrefixed = meaningful.length > 0 && meaningful.every(matches);

		let counter = 0;
		return lines.map((line) => {
			if (line.trim().length === 0) return line;
			if (allPrefixed) return bareLine(line);
			return build(bareLine(line), counter++);
		});
	});
}

function insertBlock(area: HTMLTextAreaElement, block: string, selectOffset?: [number, number]): void {
	const value = area.value;
	const start = area.selectionStart;
	const end = area.selectionEnd;

	const before = start === 0 || value.slice(0, start).endsWith("\n\n") ? "" : value.slice(0, start).endsWith("\n") ? "\n" : "\n\n";
	const after = end === value.length || value.slice(end).startsWith("\n\n") ? "" : value.slice(end).startsWith("\n") ? "\n" : "\n\n";

	const text = `${before}${block}${after}`;
	const anchor = start + before.length;

	if (selectOffset === undefined) {
		replaceRange(area, start, end, text, anchor + block.length, anchor + block.length);
		return;
	}

	replaceRange(area, start, end, text, anchor + selectOffset[0], anchor + selectOffset[1]);
}

export function toggleBold(area: HTMLTextAreaElement): void {
	toggleWrap(area, "**", "bold text");
}

export function toggleItalic(area: HTMLTextAreaElement): void {
	toggleWrap(area, "_", "italic text");
}

export function toggleStrikethrough(area: HTMLTextAreaElement): void {
	toggleWrap(area, "~~", "struck through");
}

export function toggleInlineCode(area: HTMLTextAreaElement): void {
	toggleWrap(area, "`", "code");
}

export function toggleHeading(area: HTMLTextAreaElement, level: number): void {
	const prefix = `${"#".repeat(level)} `;
	togglePrefix(
		area,
		(line) => line.startsWith(prefix),
		(line) => `${prefix}${line}`,
	);
}

export function toggleQuote(area: HTMLTextAreaElement): void {
	togglePrefix(
		area,
		(line) => line.startsWith("> "),
		(line) => `> ${line}`,
	);
}

export function toggleBulletList(area: HTMLTextAreaElement): void {
	togglePrefix(
		area,
		(line) => /^[-*+]\s+/.test(line) && !/^[-*+]\s+\[[ xX]\]/.test(line),
		(line) => `- ${line}`,
	);
}

export function toggleOrderedList(area: HTMLTextAreaElement): void {
	togglePrefix(
		area,
		(line) => /^\d+\.\s+/.test(line),
		(line, index) => `${index + 1}. ${line}`,
	);
}

export function toggleTaskList(area: HTMLTextAreaElement): void {
	togglePrefix(
		area,
		(line) => /^[-*+]\s+\[[ xX]\]\s+/.test(line),
		(line) => `- [ ] ${line}`,
	);
}

export function insertLink(area: HTMLTextAreaElement): void {
	const start = area.selectionStart;
	const end = area.selectionEnd;
	const selected = area.value.slice(start, end);

	if (selected.length === 0) {
		const text = "[link text](https://)";
		replaceRange(area, start, end, text, start + 1, start + 10);
		return;
	}

	if (/^(https?:\/\/|mailto:|\/)\S*$/.test(selected)) {
		const text = `[link text](${selected})`;
		replaceRange(area, start, end, text, start + 1, start + 10);
		return;
	}

	const text = `[${selected}](https://)`;
	const urlStart = start + selected.length + 3;
	replaceRange(area, start, end, text, urlStart, urlStart + 8);
}

export function insertCodeBlock(area: HTMLTextAreaElement): void {
	const start = area.selectionStart;
	const end = area.selectionEnd;
	const selected = area.value.slice(start, end);

	if (selected.length === 0) {
		insertBlock(area, "```\n\n```", [3, 3]);
		return;
	}

	insertBlock(area, `\`\`\`\n${selected}\n\`\`\``, [3, 3]);
}

export function insertTable(area: HTMLTextAreaElement): void {
	insertBlock(area, "| Column | Column |\n| --- | --- |\n| Cell | Cell |", [2, 8]);
}

export function insertRule(area: HTMLTextAreaElement): void {
	insertBlock(area, "---");
}

const ICONS: Record<string, string> = {
	link: `<path d="M9 15l6-6"/><path d="M11 6l.463-.536a5 5 0 0 1 7.071 7.072l-.534.464"/><path d="M13 18l-.397.534a5.068 5.068 0 0 1-7.127 0a4.972 4.972 0 0 1 0-7.071l.524-.463"/>`,
	code: `<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>`,
	quote: `<path d="M10 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-.833 4.333-2.5 5"/><path d="M19 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-.833 4.333-2.5 5"/>`,
	bullet: `<path d="M9 6l11 0"/><path d="M9 12l11 0"/><path d="M9 18l11 0"/><path d="M5 6l0 .01"/><path d="M5 12l0 .01"/><path d="M5 18l0 .01"/>`,
	ordered: `<path d="M11 6h9"/><path d="M11 12h9"/><path d="M12 18h8"/><path d="M4 16a2 2 0 1 1 4 0c0 .591-.5 1-1 1.5l-3 2.5h4"/><path d="M6 10v-6l-2 2"/>`,
	task: `<path d="M11 6h9"/><path d="M11 12h9"/><path d="M11 18h9"/><path d="M3 6l1.5 1.5l3-3"/><path d="M3 12l1.5 1.5l3-3"/><path d="M3 18l1.5 1.5l3-3"/>`,
	codeBlock: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 10l-2 2l2 2"/><path d="M15 10l2 2l-2 2"/>`,
	table: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M10 4v16"/>`,
	rule: `<path d="M5 12l14 0"/>`,
	image: `<path d="M15 8h.01"/><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l5 5"/><path d="M14 14l1-1c.928-.893 2.072-.893 3 0l3 3"/>`,
};

function icon(name: string): HTMLElement {
	const button = el("span", { class: "icon" });
	button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
	return button;
}

interface ToolbarOptions {
	onChange: () => void;
	onInsertImage: () => void;
}

export function createMarkdownToolbar(area: HTMLTextAreaElement, options: ToolbarOptions): HTMLElement {
	const run = (command: (area: HTMLTextAreaElement) => void) => () => {
		command(area);
		options.onChange();
	};

	const button = (title: string, onClick: () => void, label?: string, iconName?: string, className = "") =>
		el(
			"button",
			{ type: "button", class: `md-button ${className}`.trim(), title, "aria-label": title, onClick },
			iconName === undefined ? label : icon(iconName),
		);

	const divider = () => el("span", { class: "md-divider", "aria-hidden": "true" });

	return el(
		"div",
		{ class: "md-toolbar", role: "toolbar", "aria-label": "Formatting" },

		button(
			"Heading 1",
			run((a) => toggleHeading(a, 1)),
			"H1",
			undefined,
			"md-text",
		),
		button(
			"Heading 2",
			run((a) => toggleHeading(a, 2)),
			"H2",
			undefined,
			"md-text",
		),
		button(
			"Heading 3",
			run((a) => toggleHeading(a, 3)),
			"H3",
			undefined,
			"md-text",
		),

		divider(),

		button("Bold  (Ctrl+B)", run(toggleBold), "B", undefined, "md-text md-bold"),
		button("Italic  (Ctrl+I)", run(toggleItalic), "I", undefined, "md-text md-italic"),
		button("Strikethrough", run(toggleStrikethrough), "S", undefined, "md-text md-strike"),
		button("Inline code  (Ctrl+E)", run(toggleInlineCode), undefined, "code"),

		divider(),

		button("Link  (Ctrl+K)", run(insertLink), undefined, "link"),
		button("Image", options.onInsertImage, undefined, "image"),

		divider(),

		button("Bulleted list", run(toggleBulletList), undefined, "bullet"),
		button("Numbered list", run(toggleOrderedList), undefined, "ordered"),
		button("Task list", run(toggleTaskList), undefined, "task"),
		button("Quote", run(toggleQuote), undefined, "quote"),

		divider(),

		button("Code block", run(insertCodeBlock), undefined, "codeBlock"),
		button("Table", run(insertTable), undefined, "table"),
		button("Horizontal rule", run(insertRule), undefined, "rule"),
	);
}

/**
 * Bound to the textarea rather than the document so they cannot fire while the
 * author is typing in the title or description.
 */
export function installShortcuts(area: HTMLTextAreaElement, onChange: () => void): void {
	area.addEventListener("keydown", (event) => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

		const key = event.key.toLowerCase();
		const command: ((a: HTMLTextAreaElement) => void) | undefined = {
			b: toggleBold,
			i: toggleItalic,
			e: toggleInlineCode,
			k: insertLink,
			"1": (a: HTMLTextAreaElement) => toggleHeading(a, 1),
			"2": (a: HTMLTextAreaElement) => toggleHeading(a, 2),
			"3": (a: HTMLTextAreaElement) => toggleHeading(a, 3),
		}[key];

		if (command === undefined) return;

		event.preventDefault();
		command(area);
		onChange();
	});
}
