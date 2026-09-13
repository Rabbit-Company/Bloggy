import { api, type AnalyticsResult } from "../api.ts";
import { instanceConfig } from "../constants.ts";
import { el, render } from "../ui.ts";

const WINDOWS = [
	{ hours: 24, label: "24 hours" },
	{ hours: 168, label: "7 days" },
	{ hours: 720, label: "30 days" },
] as const;

const TABS = [
	{ view: "overview", label: "Traffic" },
	{ view: "paths", label: "Pages" },
	{ view: "geography", label: "Countries" },
	{ view: "referrers", label: "Referrers" },
] as const;

let currentView: string = "overview";
let currentHours = 168;
let currentMetric: "requests" | "uniqueIps" = "requests";
let currentPage: string | undefined;
let pageOptions: { value: string; label: string }[] | null = null;

function formatValue(value: number | null, unit: string): string {
	if (value === null) return "-";
	const rounded = unit === "%" || unit === "ms" ? Math.round(value * 10) / 10 : Math.round(value);
	return rounded.toLocaleString();
}

function chart(data: AnalyticsResult): HTMLElement {
	if (data.points.length === 0) return el("div", { class: "empty" }, "No traffic in this window.");

	return el(
		"div",
		{},
		el(
			"div",
			{ class: "chart" },
			...data.points.map((point) =>
				el("div", {
					class: "bar",
					style: `height:${Math.max(2, point.height)}%`,
					title: `${new Date(point.timestamp).toLocaleString()}: ${formatValue(point.value, data.unit)} ${data.unit}`,
				}),
			),
		),
		el(
			"div",
			{ class: "chart-axis" },
			el("span", {}, new Date(data.from).toLocaleDateString()),
			el("span", {}, `peak ${formatValue(data.maximum, data.unit)} ${data.unit}`),
			el("span", {}, new Date(data.to).toLocaleDateString()),
		),
	);
}

function table(data: AnalyticsResult, heading: string): HTMLElement {
	if (data.rows.length === 0) return el("div", { class: "empty" }, "Nothing recorded in this window.");

	const rows = [...data.rows].sort((a, b) => b.value - a.value);
	const top = Math.max(...rows.map((row) => row.value));

	return el(
		"table",
		{ class: "data" },
		el(
			"thead",
			{},
			el("tr", {}, el("th", {}, heading), el("th", {}, data.metric === "uniqueIps" ? "Unique IPs" : "Page views"), el("th", { style: "width:40%" }, "")),
		),
		el(
			"tbody",
			{},
			...rows.map((row) =>
				el(
					"tr",
					{},
					el("td", { style: "word-break:break-all" }, el("div", {}, row.label), row.detail !== undefined && el("div", { class: "row-detail" }, row.detail)),
					el("td", {}, row.value.toLocaleString()),
					el("td", {}, el("div", { class: "meter" }, el("span", { style: `width:${(row.value / top) * 100}%;background:var(--accent)` }))),
				),
			),
		),
	);
}

const countryNames = new Intl.DisplayNames(undefined, { type: "region" });

function countryName(code: string): string {
	if (code === "ZZ" || code === "XX") return "Unknown";
	try {
		return countryNames.of(code) ?? code;
	} catch {
		return code;
	}
}

async function worldMap(rows: { label: string; value: number }[], metric: AnalyticsResult["metric"]): Promise<HTMLElement> {
	const host = el("div", { class: "map" }, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading map…"));

	try {
		const svg = await api.worldMap();
		const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
		const root = parsed.documentElement;
		if (root.nodeName === "parsererror" || root.querySelector("parsererror") !== null) throw new Error("The map could not be parsed.");

		const counts = new Map(rows.filter((row) => row.label !== "ZZ" && row.label !== "XX").map((row) => [row.label.toUpperCase(), row.value]));
		const top = Math.max(1, ...counts.values());

		for (const [code, value] of counts) {
			const shapes = root.querySelectorAll(`#${CSS.escape(code)}, #${CSS.escape(code.toLowerCase())}, [data-id="${CSS.escape(code)}"]`);
			const intensity = Math.log1p(value) / Math.log1p(top);
			for (const shape of shapes) {
				(shape as SVGElement).style.fill = `color-mix(in srgb, var(--accent) ${Math.round(15 + intensity * 85)}%, var(--surface-2))`;
				const title = parsed.createElementNS("http://www.w3.org/2000/svg", "title");
				title.textContent = `${countryName(code)}: ${value.toLocaleString()} ${metric === "uniqueIps" ? "unique IPs" : "page views"}`;
				shape.appendChild(title);
			}
		}

		root.setAttribute("width", "100%");
		root.setAttribute("height", "100%");
		host.replaceChildren(root);
	} catch (err) {
		host.replaceChildren(el("div", { class: "empty" }, err instanceof Error ? err.message : "The map could not be loaded."));
	}

	return host;
}

export async function renderAnalytics(root: HTMLElement): Promise<void> {
	if (instanceConfig().analytics !== "burrowgate") {
		render(
			root,
			el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Analytics"))),
			el(
				"div",
				{ class: "empty" },
				el("p", {}, "Analytics is not available on this instance."),
				el("p", { class: "hint" }, "It appears when Bloggy runs behind a BurrowGate gateway with a read-only monitoring token configured."),
			),
		);
		return;
	}

	const body = el("div", {}, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading analytics…"));

	const visibleTabs = currentPage === undefined ? TABS : TABS.filter((tab) => tab.view !== "paths");
	if (!visibleTabs.some((tab) => tab.view === currentView)) currentView = "overview";

	const tabs = el(
		"nav",
		{ class: "tabs" },
		...visibleTabs.map((tab) =>
			el(
				"button",
				{
					class: `tab ${tab.view === currentView ? "active" : ""}`,
					onClick: () => {
						currentView = tab.view;
						void renderAnalytics(root);
					},
				},
				tab.label,
			),
		),
	);

	const windows = WINDOWS.map((option) =>
		el(
			"button",
			{
				class: `button small ${option.hours === currentHours ? "primary" : "ghost"}`,
				onClick: () => {
					currentHours = option.hours;
					void renderAnalytics(root);
				},
			},
			option.label,
		),
	);

	const metrics = (
		[
			{ value: "requests", label: "Page views" },
			{ value: "uniqueIps", label: "Unique IPs" },
		] as const
	).map((option) =>
		el(
			"button",
			{
				class: `button small ${option.value === currentMetric ? "primary" : "ghost"}`,
				"aria-pressed": option.value === currentMetric ? "true" : "false",
				onClick: () => {
					currentMetric = option.value;
					void renderAnalytics(root);
				},
			},
			option.label,
		),
	);

	const picker = el(
		"select",
		{
			class: "input small",
			"aria-label": "Page",
			onChange: (event: Event) => {
				const chosen = (event.target as HTMLSelectElement).value;
				currentPage = chosen === "" ? undefined : chosen;
				void renderAnalytics(root);
			},
		},
		el("option", { value: "", selected: currentPage === undefined }, "Whole blog"),
		...(pageOptions ?? []).map((option) => el("option", { value: option.value, selected: option.value === currentPage }, option.label)),
	);

	const subtitle =
		currentMetric === "uniqueIps"
			? "Unique IPs are only an estimate of readership. Shared and changing addresses can affect the count."
			: currentPage === undefined
				? "Page views served by the gateway in front of this blog."
				: "Page views served for this page. Errors and probes are excluded.";

	render(
		root,
		el(
			"div",
			{ class: "page-head analytics-head" },
			el("div", {}, el("h1", {}, "Analytics"), el("p", {}, subtitle)),
			el(
				"div",
				{ class: "actions analytics-controls" },
				picker,
				el("div", { class: "analytics-segment", role: "group", "aria-label": "Metric" }, ...metrics),
				el("div", { class: "analytics-segment", role: "group", "aria-label": "Time range" }, ...windows),
			),
		),
		tabs,
		body,
	);

	if (pageOptions === null) {
		try {
			pageOptions = (await api.analyticsPages()).pages;
			for (const option of pageOptions) picker.append(el("option", { value: option.value, selected: option.value === currentPage }, option.label));
		} catch {
			pageOptions = [];
		}
	}

	let data: AnalyticsResult;
	try {
		data = await api.analytics(currentView, currentHours, currentMetric, currentPage);
	} catch (err) {
		body.replaceChildren(el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load analytics."));
		return;
	}

	const stats = el(
		"div",
		{ class: "stats" },
		...data.stats.map((entry) =>
			el(
				"div",
				{ class: "stat" },
				el("div", { class: "value" }, formatValue(entry.value, entry.unit)),
				el("div", { class: "label" }, entry.unit && entry.unit.toLowerCase() !== entry.label.toLowerCase() ? `${entry.label} (${entry.unit})` : entry.label),
			),
		),
	);

	if (!data.hasData) {
		body.replaceChildren(stats, el("div", { class: "empty" }, "No traffic recorded in this window yet."));
		return;
	}

	if (currentView === "geography") {
		const map = await worldMap(data.rows, data.metric);
		body.replaceChildren(
			stats,
			el("div", { class: "card" }, el("h2", {}, "Where readers are"), map),
			el(
				"div",
				{ class: "card" },
				el("h2", {}, "By country"),
				table({ ...data, rows: data.rows.map((row) => ({ ...row, label: countryName(row.label) })) }, "Country"),
			),
		);
		return;
	}

	if (currentView === "paths" || currentView === "referrers") {
		const heading =
			currentView === "paths"
				? data.metric === "uniqueIps"
					? "Pages by audience"
					: "Most read pages"
				: data.metric === "uniqueIps"
					? "Sources by audience"
					: "Where readers came from";
		body.replaceChildren(stats, el("div", { class: "card" }, el("h2", {}, heading), table(data, currentView === "paths" ? "Page" : "Referrer")));
		return;
	}

	body.replaceChildren(stats, el("div", { class: "card" }, el("h2", {}, data.title), chart(data)));
}
