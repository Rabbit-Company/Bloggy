export const EMBED_DATE_FORMATS = [
	{ value: "iso", label: "2026-04-29 (ISO)" },
	{ value: "short", label: "Apr 29, 2026" },
	{ value: "long", label: "April 29, 2026" },
	{ value: "day-first", label: "29 April 2026" },
	{ value: "ordinal", label: "April 29th 2026" },
] as const;

export type EmbedDateFormat = (typeof EMBED_DATE_FORMATS)[number]["value"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export function formatEmbedDate(iso: string, format: EmbedDateFormat): string {
	const date = iso.slice(0, 10);
	if (format === "iso") return date;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return date;
	const year = match[1];
	const month = MONTHS[Number(match[2]) - 1];
	const day = Number(match[3]);
	if (!month || day < 1 || day > 31) return date;
	if (format === "short") return `${month.slice(0, 3)} ${day}, ${year}`;
	if (format === "long") return `${month} ${day}, ${year}`;
	if (format === "day-first") return `${day} ${month} ${year}`;
	const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
	return `${month} ${day}${suffix} ${year}`;
}

export interface EmbedCustomizationInput {
	showTitle: boolean;
	showDescription: boolean;
	showSearch: boolean;
	showSocial: boolean;
	showAuthor: boolean;
	showDate: boolean;
	showReadTime: boolean;
	dateFormat: EmbedDateFormat;
	showPostDescriptions: boolean;
	showShare: boolean;
	customCss: string;
}

export const DEFAULT_EMBED_CUSTOMIZATION: EmbedCustomizationInput = {
	showTitle: false,
	showDescription: false,
	showSearch: false,
	showSocial: false,
	showAuthor: false,
	showDate: false,
	showReadTime: false,
	dateFormat: "iso",
	showPostDescriptions: false,
	showShare: false,
	customCss: "",
};
