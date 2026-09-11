import { api, type Backup } from "../api.ts";
import { confirm, el, formatBytes, formatDateTime, modal, render, toast } from "../ui.ts";

function describeInterval(seconds: number): string {
	if (seconds % 86_400 === 0) return seconds === 86_400 ? "every day" : `every ${seconds / 86_400} days`;
	if (seconds % 3_600 === 0) return seconds === 3_600 ? "every hour" : `every ${seconds / 3_600} hours`;
	return `every ${Math.round(seconds / 60)} minutes`;
}

/**
 * Restoring stops the server, so it asks for the file name to be typed rather
 * than accepting a single click, and says plainly what is about to happen.
 */
async function confirmRestore(backup: Backup): Promise<boolean> {
	const values = await modal({
		title: "Restore this backup?",
		body: [
			el("p", {}, `Every account, post and setting will be replaced with the contents of ${backup.name}.`),
			el(
				"p",
				{},
				"The current database is kept alongside the new one, and the server stops so it can restart into the restored copy. It will be unavailable for a few seconds.",
			),
			el("p", { class: "hint" }, "Images are not part of a backup, so anything uploaded since this snapshot stays in storage but stops being listed."),
			el("label", { class: "field" }, el("span", {}, "Type the file name to confirm"), el("input", { name: "confirm", type: "text", autocomplete: "off" })),
		],
		confirmLabel: "Replace the database",
		danger: true,
	});

	if (values === null) return false;
	if (values.confirm !== backup.name) {
		toast("The name did not match. Nothing was restored.", "error");
		return false;
	}
	return true;
}

function row(backup: Backup, reload: () => void): HTMLElement {
	const download = el("a", { class: "button small", href: api.backupUrl(backup.name), download: backup.name }, "Download");

	const restore = el("button", { class: "button small" }, "Restore");
	restore.addEventListener("click", async () => {
		if (!(await confirmRestore(backup))) return;
		restore.disabled = true;
		try {
			await api.adminRestoreBackup(backup.name);
			toast("Database replaced. The server is restarting, reload in a few seconds.", "success", 20000);
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not restore that backup.", "error");
			restore.disabled = false;
		}
	});

	const remove = el("button", { class: "button small danger" }, "Delete");
	remove.addEventListener("click", async () => {
		const ok = await confirm({
			title: `Delete ${backup.name}?`,
			body: [el("p", {}, "This removes the snapshot from storage. It does not affect the running database.")],
			confirmLabel: "Delete",
			danger: true,
		});
		if (!ok) return;

		try {
			await api.adminDeleteBackup(backup.name);
			toast("Backup deleted.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not delete that backup.", "error");
		}
	});

	return el(
		"tr",
		{},
		el("td", {}, el("span", { class: "mono" }, backup.name)),
		el("td", {}, formatDateTime(backup.createdAt)),
		el("td", { class: "numeric" }, formatBytes(backup.size)),
		el("td", { class: "row-actions" }, el("span", { class: "actions" }, download, restore, remove)),
	);
}

export async function renderBackups(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading backups…"));

	let result: Awaited<ReturnType<typeof api.adminBackups>>;
	try {
		result = await api.adminBackups();
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load backups."));
		return;
	}

	const reload = () => void renderBackups(root);

	const takeNow = el("button", { class: "button primary" }, "Back up now");
	takeNow.addEventListener("click", async () => {
		takeNow.disabled = true;
		takeNow.textContent = "Working…";
		try {
			const entry = await api.adminCreateBackup();
			toast(`${entry.name} created (${formatBytes(entry.size)}).`, "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not create a backup.", "error");
			takeNow.disabled = false;
			takeNow.textContent = "Back up now";
		}
	});

	if (!result.available) {
		render(
			root,
			el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Backups"))),
			el("div", { class: "empty" }, result.reason ?? "Backups are not available on this instance."),
		);
		return;
	}

	const schedule = result.enabled
		? `Automatic backups run ${describeInterval(result.intervalSeconds)}, keeping the newest ${result.keep}.`
		: `Automatic backups are off. Set BACKUP_ENABLED=true to run them ${describeInterval(result.intervalSeconds)}.`;

	render(
		root,
		el(
			"div",
			{ class: "page-head" },
			el(
				"div",
				{},
				el("h1", {}, "Backups"),
				el("p", {}, schedule),
				el(
					"p",
					{ class: "hint" },
					"A backup holds every account, post and setting, including password hashes. Keep the bucket private. Uploaded images are not included: they already live in object storage.",
				),
			),
			takeNow,
		),
		result.backups.length === 0
			? el("div", { class: "empty" }, "No backups yet.")
			: el(
					"div",
					{ class: "table-wrap" },
					el(
						"table",
						{ class: "admin-table" },
						el("thead", {}, el("tr", {}, el("th", {}, "File"), el("th", {}, "Taken"), el("th", { class: "numeric" }, "Size"), el("th", {}, ""))),
						el("tbody", {}, ...result.backups.map((backup) => row(backup, reload))),
					),
				),
	);
}
