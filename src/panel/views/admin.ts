import { api, type AdminCreator } from "../api.ts";
import { confirm, el, formatBytes, formatDate, modal, pagination, render, toast } from "../ui.ts";

type Sort = "username" | "posts" | "storage" | "created" | "accessed";

const COLUMNS: { key: Sort; label: string; numeric?: boolean }[] = [
	{ key: "username", label: "Creator" },
	{ key: "posts", label: "Posts", numeric: true },
	{ key: "storage", label: "Storage", numeric: true },
	{ key: "created", label: "Registered" },
	{ key: "accessed", label: "Last active" },
];

let sort: Sort = "storage";
let descending = true;
let creatorOffset = 0;
let creatorSearch = "";
const PAGE_SIZE = 25;

function badge(row: AdminCreator): HTMLElement | string {
	if (row.isAdmin) return el("span", { class: "pill admin" }, "admin");
	if (row.suspendedAt !== null) return el("span", { class: "pill suspended" }, "suspended");
	return "";
}

/**
 * Deleting an account is irreversible and takes every post and image with it,
 * so it asks for the username to be typed rather than for a single click.
 */
async function confirmDelete(row: AdminCreator): Promise<boolean> {
	const values = await modal({
		title: `Delete ${row.username}?`,
		body: [
			el("p", {}, `This permanently removes the account, ${row.posts + row.drafts} post(s) and ${formatBytes(row.storage)} of images.`),
			el("p", {}, "Suspending is reversible. Deleting is not."),
			el("label", { class: "field" }, el("span", {}, `Type ${row.username} to confirm`), el("input", { name: "confirm", type: "text", autocomplete: "off" })),
		],
		confirmLabel: "Delete permanently",
		danger: true,
	});

	if (values === null) return false;
	if (values.confirm !== row.username) {
		toast("The username did not match. Nothing was deleted.", "error");
		return false;
	}
	return true;
}

function syncButton(row: AdminCreator, reload: () => void): HTMLElement {
	const button = el("button", { class: "button small ghost", title: "Re-read this account's files from storage and recompute usage" }, "Recalculate");
	button.addEventListener("click", async () => {
		button.disabled = true;
		button.textContent = "Working...";
		try {
			const result = await api.adminSyncMedia(row.username);
			toast(syncSummary(result.imported, result.pruned, result.skipped.length, formatBytes(result.usage)), "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not recalculate storage.", "error");
			button.disabled = false;
			button.textContent = "Recalculate";
		}
	});
	return button;
}

function syncSummary(imported: number, pruned: number, skipped: number, usage: string): string {
	const parts = [];
	if (imported > 0) parts.push(`${imported} imported`);
	if (pruned > 0) parts.push(`${pruned} removed`);
	if (skipped > 0) parts.push(`${skipped} skipped`);
	return parts.length === 0 ? `Already up to date. ${usage} stored.` : `${parts.join(", ")}. ${usage} stored.`;
}

function actions(row: AdminCreator, reload: () => void): HTMLElement {
	if (row.isAdmin) return el("span", { class: "actions" }, syncButton(row, reload));

	const suspended = row.suspendedAt !== null;

	const toggle = el("button", { class: `button small${suspended ? "" : " warning"}` }, suspended ? "Restore" : "Suspend");
	toggle.addEventListener("click", async () => {
		if (!suspended) {
			const ok = await confirm({
				title: `Suspend ${row.username}?`,
				body: [el("p", {}, "Their blog stops resolving, every session is signed out, and they cannot log back in. Posts are kept and this can be undone.")],
				confirmLabel: "Suspend",
			});
			if (!ok) return;
		}

		try {
			await api.adminSuspend(row.username, !suspended);
			toast(suspended ? `${row.username} restored.` : `${row.username} suspended.`, "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not update the account.", "error");
		}
	});

	const remove = el("button", { class: "button small danger" }, "Delete");
	remove.addEventListener("click", async () => {
		if (!(await confirmDelete(row))) return;
		try {
			await api.adminDeleteCreator(row.username);
			toast(`${row.username} deleted.`, "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not delete the account.", "error");
		}
	});

	return el("span", { class: "actions" }, syncButton(row, reload), toggle, remove);
}

function header(reload: () => void): HTMLElement {
	return el(
		"tr",
		{},
		...COLUMNS.map((column) => {
			const active = sort === column.key;
			const cell = el(
				"th",
				{ class: `sortable${active ? " active" : ""}${column.numeric ? " numeric" : ""}` },
				`${column.label}${active ? (descending ? " ↓" : " ↑") : ""}`,
			);
			cell.addEventListener("click", () => {
				// Clicking the active column flips direction. A new column starts
				// descending, which is what you want for "who is using the most".
				if (active) descending = !descending;
				else {
					sort = column.key;
					descending = true;
				}
				creatorOffset = 0;
				reload();
			});
			return cell;
		}),
		el("th", {}, "Premium"),
		el("th", {}, "Custom domain"),
		el("th", {}, "Status"),
		el("th", {}, ""),
	);
}

export async function renderAdmin(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading accounts..."));

	let creators: AdminCreator[];
	let total = 0;
	try {
		const result = await api.adminCreators(sort, descending ? "desc" : "asc", PAGE_SIZE, creatorOffset, creatorSearch);
		creators = result.creators;
		total = result.total;
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load the account list."));
		return;
	}
	if (creatorOffset > 0 && creatorOffset >= total) {
		creatorOffset = total === 0 ? 0 : Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE;
		return await renderAdmin(root);
	}

	const reload = () => void renderAdmin(root);
	const searchInput = el("input", { type: "search", value: creatorSearch, placeholder: "Search username or email...", "aria-label": "Search accounts" });
	const searchButton = el("button", { class: "button ghost" }, "Search");
	const applySearch = () => {
		creatorSearch = searchInput.value.trim();
		creatorOffset = 0;
		reload();
	};
	searchButton.addEventListener("click", applySearch);
	searchInput.addEventListener("keydown", (event) => {
		if ((event as KeyboardEvent).key === "Enter") applySearch();
	});

	const rows = creators.map((row) =>
		el(
			"tr",
			{ class: row.suspendedAt === null ? "" : "is-suspended" },
			el(
				"td",
				{},
				el("a", { href: `/creator/${row.username}`, target: "_blank", rel: "noopener" }, row.username),
				el("span", { class: "sub" }, row.email),
				el("span", { class: "sub creator-author" }, row.author),
			),
			el("td", { class: "numeric" }, row.drafts > 0 ? `${row.posts} (+${row.drafts})` : String(row.posts)),
			el(
				"td",
				{ class: "numeric" },
				formatBytes(row.storage),
				el("span", { class: "sub" }, row.storageLimit <= 0 ? "Unlimited allowance" : `of ${formatBytes(row.storageLimit)}`),
			),
			el("td", {}, formatDate(row.createdAt)),
			el("td", {}, formatDate(row.accessedAt)),
			el(
				"td",
				{},
				row.activeLicenses > 0 ? el("span", { class: "pill license-active" }, "active") : el("span", { class: "pill license-expired" }, "none"),
				el("span", { class: "sub" }, `${row.activeLicenses} active`),
				el("span", { class: "sub" }, `${row.licensesUsed} redeemed`),
			),
			el("td", {}, row.customDomain ? el("span", { class: "pill license-active" }, "Available") : "No"),
			el("td", {}, badge(row)),
			el("td", { class: "row-actions" }, actions(row, reload)),
		),
	);

	const syncAll = el("button", { class: "button ghost", title: "Re-read every account's files from storage" }, "Sync all from storage");
	syncAll.addEventListener("click", async () => {
		syncAll.disabled = true;
		syncAll.textContent = "Working...";
		try {
			const result = await api.adminSyncAllMedia();
			toast(`${result.creators} accounts. ${syncSummary(result.imported, result.pruned, result.skipped.length, "Usage recalculated.")}`, "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not sync storage.", "error");
			syncAll.disabled = false;
			syncAll.textContent = "Sync all from storage";
		}
	});

	render(
		root,
		el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Moderation"), el("p", {}, `${total} account${total === 1 ? "" : "s"}`)), syncAll),
		el("div", { class: "table-controls" }, el("div", { class: "search-control" }, searchInput, searchButton)),
		creators.length === 0
			? el("div", { class: "empty" }, creatorSearch ? "No accounts match this search." : "No accounts yet.")
			: el("div", { class: "table-wrap" }, el("table", { class: "admin-table" }, el("thead", {}, header(reload)), el("tbody", {}, ...rows))),
		pagination(total, PAGE_SIZE, creatorOffset, (offset) => {
			creatorOffset = offset;
			reload();
		}),
	);
}
