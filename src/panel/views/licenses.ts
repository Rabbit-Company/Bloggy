import { api, type License } from "../api.ts";
import { copyText } from "../image-picker.ts";
import { confirm, el, formatBytes, formatDate, formatDateTime, pagination, render, toast } from "../ui.ts";

let latestKeys: string[] = [];
let licenseOffset = 0;
let licenseSearch = "";
const PAGE_SIZE = 25;

function statusBadge(status: License["status"]): HTMLElement {
	return el("span", { class: `pill license-${status}` }, status);
}

function entitlementText(license: License): string {
	const values: string[] = [];
	if (license.storageBytes > 0) values.push(`+${formatBytes(license.storageBytes)}`);
	if (license.customDomain) values.push("Custom domain");
	return values.join(" · ");
}

function generatedKeys(): HTMLElement | false {
	if (latestKeys.length === 0) return false;

	const textarea = el("textarea", { class: "code license-output", readonly: true, rows: Math.min(14, Math.max(4, latestKeys.length)) });
	textarea.value = `${latestKeys.join("\n")}\n`;
	const copyAll = el("button", { class: "button primary" }, "Copy all keys");
	copyAll.addEventListener(
		"click",
		() => void copyText(latestKeys.join("\n"), `${latestKeys.length} license key${latestKeys.length === 1 ? "" : "s"} copied.`),
	);

	return el(
		"div",
		{ class: "card generated-licenses" },
		el(
			"div",
			{ class: "card-top" },
			el("div", {}, el("h2", {}, "Generated license keys"), el("p", { class: "hint" }, "Save these now. Full keys are not stored and cannot be shown again.")),
			copyAll,
		),
		textarea,
		el(
			"div",
			{ class: "generated-key-list" },
			...latestKeys.map((key) => {
				const copy = el("button", { class: "button small ghost" }, "Copy");
				copy.addEventListener("click", () => void copyText(key, "License key copied."));
				return el("div", { class: "generated-key" }, el("code", {}, key), copy);
			}),
		),
	);
}

export async function renderLicenses(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading licenses..."));

	let licenses: License[];
	let total = 0;
	try {
		const result = await api.adminLicenses(PAGE_SIZE, licenseOffset, licenseSearch);
		licenses = result.licenses;
		total = result.total;
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load licenses."));
		return;
	}
	if (licenseOffset > 0 && licenseOffset >= total) {
		licenseOffset = total === 0 ? 0 : Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE;
		return await renderLicenses(root);
	}

	const reload = () => void renderLicenses(root);
	const searchInput = el("input", { type: "search", value: licenseSearch, placeholder: "Search key or redeemed by...", "aria-label": "Search licenses" });
	const searchButton = el("button", { class: "button ghost" }, "Search");
	const applySearch = () => {
		licenseSearch = searchInput.value.trim();
		licenseOffset = 0;
		reload();
	};
	searchButton.addEventListener("click", applySearch);
	searchInput.addEventListener("keydown", (event) => {
		if ((event as KeyboardEvent).key === "Enter") applySearch();
	});
	const count = el("input", { id: "license-count", type: "number", min: "1", max: "500", step: "1", value: "1" });
	const duration = el("input", { id: "license-duration", type: "number", min: "1", max: "3650", step: "1", value: "30" });
	const storage = el("input", { id: "license-storage", type: "number", min: "0", step: "0.1", value: "5" });
	const unit = el("select", { id: "license-unit" }, el("option", { value: String(1024 ** 3) }, "GB"), el("option", { value: String(1024 ** 2) }, "MB"));
	const customDomain = el("input", { id: "license-custom-domain", type: "checkbox", class: "license-checkbox" });
	const generate = el("button", { class: "button primary" }, "Generate license keys");

	generate.addEventListener("click", async () => {
		const countValue = Number(count.value);
		const durationValue = Number(duration.value);
		const storageValue = Number(storage.value);
		if (!Number.isInteger(countValue) || countValue < 1 || countValue > 500) {
			toast("Count must be a whole number from 1 to 500.", "error");
			return;
		}
		if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 3650) {
			toast("Duration must be a whole number from 1 to 3650 days.", "error");
			return;
		}
		if (!Number.isFinite(storageValue) || storageValue < 0) {
			toast("Storage must be zero or more.", "error");
			return;
		}

		const storageBytes = Math.round(storageValue * Number(unit.value));
		if (storageBytes === 0 && !customDomain.checked) {
			toast("Include storage, custom-domain access, or both.", "error");
			return;
		}

		generate.disabled = true;
		generate.textContent = "Generating...";
		try {
			const result = await api.adminCreateLicenses({
				count: countValue,
				durationDays: durationValue,
				storageBytes,
				customDomain: customDomain.checked,
			});
			latestKeys = result.keys;
			licenseOffset = 0;
			toast(`${result.keys.length} license key${result.keys.length === 1 ? "" : "s"} generated.`, "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not generate licenses.", "error");
			generate.disabled = false;
			generate.textContent = "Generate license keys";
		}
	});

	const rows = licenses.map((license) => {
		const revoke = el("button", { class: "button small danger", disabled: license.status === "revoked" }, "Revoke");
		revoke.addEventListener("click", async () => {
			if (
				!(await confirm({
					title: "Revoke this license?",
					body: [el("p", {}, "Its storage and custom-domain benefits stop immediately. This cannot be undone.")],
					confirmLabel: "Revoke license",
					danger: true,
				}))
			)
				return;
			try {
				await api.adminRevokeLicense(license.id);
				toast("License revoked.", "success");
				reload();
			} catch (err) {
				toast(err instanceof Error ? err.message : "Could not revoke the license.", "error");
			}
		});

		return el(
			"tr",
			{},
			el("td", {}, el("code", {}, license.keyHint)),
			el("td", {}, entitlementText(license)),
			el("td", { class: "numeric" }, `${license.durationDays} days`),
			el("td", {}, statusBadge(license.status)),
			el("td", {}, license.redeemedBy ?? "Not redeemed", license.redeemedAt && el("span", { class: "sub" }, formatDateTime(license.redeemedAt))),
			el("td", {}, license.expiresAt === null ? "Starts on redemption" : formatDateTime(license.expiresAt)),
			el("td", {}, formatDate(license.createdAt)),
			el("td", { class: "row-actions" }, revoke),
		);
	});

	render(
		root,
		el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Licenses"), el("p", {}, `${total} generated license${total === 1 ? "" : "s"}`))),
		el(
			"div",
			{ class: "card" },
			el("h2", {}, "Generate licenses"),
			el("p", { class: "hint" }, "Each key starts its lifetime when it is redeemed. Benefits from multiple active keys stack."),
			el(
				"div",
				{ class: "license-form" },
				el("label", { class: "field", for: count.id }, el("span", {}, "Number of keys"), count),
				el("label", { class: "field", for: duration.id }, el("span", {}, "Duration (days)"), duration),
				el("label", { class: "field", for: storage.id }, el("span", {}, "Extra storage per key"), el("div", { class: "storage-input" }, storage, unit)),
				el("label", { class: "license-domain-toggle", for: customDomain.id }, customDomain, el("span", {}, "Include custom-domain access")),
			),
			el("div", { class: "actions license-generate-actions" }, generate),
		),
		generatedKeys(),
		el("div", { class: "table-controls" }, el("div", { class: "search-control" }, searchInput, searchButton)),
		licenses.length === 0
			? el("div", { class: "empty" }, licenseSearch ? "No licenses match this search." : "No licenses generated yet.")
			: el(
					"div",
					{ class: "table-wrap" },
					el(
						"table",
						{ class: "admin-table" },
						el(
							"thead",
							{},
							el(
								"tr",
								{},
								el("th", {}, "Key"),
								el("th", {}, "Benefits"),
								el("th", { class: "numeric" }, "Duration"),
								el("th", {}, "Status"),
								el("th", {}, "Redeemed by"),
								el("th", {}, "Expires"),
								el("th", {}, "Created"),
								el("th", {}, ""),
							),
						),
						el("tbody", {}, ...rows),
					),
				),
		pagination(total, PAGE_SIZE, licenseOffset, (offset) => {
			licenseOffset = offset;
			reload();
		}),
	);
}
