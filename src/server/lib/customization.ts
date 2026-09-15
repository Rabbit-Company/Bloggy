import { CUSTOM_CSS_MAX_BYTES, CUSTOM_TEMPLATE_MAX_BYTES } from "../../shared/constants.ts";
import { HOME_TEMPLATE_COMPONENTS, POST_TEMPLATE_COMPONENTS, type CreatorCustomizationInput } from "../../shared/customization.ts";
import { EMBED_DATE_FORMATS, type EmbedCustomizationInput } from "../../shared/embed.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import { isSafeUrl } from "../ssr/markdown.ts";

type TemplateKind = "home" | "post";

const encoder = new TextEncoder();
const ALLOWED_TAGS = new Set([
	"a",
	"abbr",
	"article",
	"aside",
	"b",
	"blockquote",
	"br",
	"code",
	"col",
	"colgroup",
	"dd",
	"details",
	"div",
	"dl",
	"dt",
	"em",
	"figcaption",
	"figure",
	"footer",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"i",
	"img",
	"li",
	"main",
	"mark",
	"nav",
	"ol",
	"p",
	"pre",
	"s",
	"section",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"time",
	"tr",
	"u",
	"ul",
]);

const GLOBAL_ATTRIBUTES = new Set(["class", "id", "title", "role", "dir", "lang", "hidden", "tabindex"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href", "target", "rel"]),
	img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
	time: new Set(["datetime"]),
	ol: new Set(["start", "reversed", "type"]),
	li: new Set(["value"]),
	details: new Set(["open"]),
	col: new Set(["span"]),
	td: new Set(["colspan", "rowspan", "headers"]),
	th: new Set(["colspan", "rowspan", "headers", "scope"]),
};

function components(kind: TemplateKind): readonly string[] {
	return kind === "home" ? HOME_TEMPLATE_COMPONENTS : POST_TEMPLATE_COMPONENTS;
}

function isAllowedAttribute(tag: string, name: string): boolean {
	return GLOBAL_ATTRIBUTES.has(name) || name.startsWith("aria-") || name.startsWith("data-") || TAG_ATTRIBUTES[tag]?.has(name) === true;
}

function safeTemplateUrl(tag: string, name: string, value: string): boolean {
	if ((tag === "a" && name === "href") || (tag === "img" && name === "src")) return isSafeUrl(value);
	return true;
}

export function sanitizeTemplate(kind: TemplateKind, source: string): string {
	if (encoder.encode(source).byteLength > CUSTOM_TEMPLATE_MAX_BYTES) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, `The ${kind} template cannot be larger than ${CUSTOM_TEMPLATE_MAX_BYTES / 1000} kB.`);
	}

	const allowedComponents = components(kind);
	const allowedComponentSet = new Set<string>(allowedComponents);
	const counts = new Map(allowedComponents.map((name) => [name, 0]));
	let invalid = "";

	const sanitized = new HTMLRewriter()
		.on("*", {
			element(element) {
				const tag = element.tagName.toLowerCase();
				if (allowedComponentSet.has(tag)) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
					for (const [name] of [...element.attributes]) element.removeAttribute(name);
					return;
				}

				if (!ALLOWED_TAGS.has(tag)) {
					invalid ||= `The <${tag}> element is not allowed in templates.`;
					element.remove();
					return;
				}

				for (const [rawName, value] of [...element.attributes]) {
					const name = rawName.toLowerCase();
					if (!isAllowedAttribute(tag, name) || !safeTemplateUrl(tag, name, value)) {
						invalid ||= `The ${rawName} attribute is not allowed on <${tag}>.`;
						element.removeAttribute(rawName);
					}
				}

				if (tag === "a" && element.getAttribute("target") === "_blank") {
					const rel = new Set((element.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
					rel.add("noopener");
					element.setAttribute("rel", [...rel].join(" "));
				}
			},
		})
		.onDocument({
			comments(comment) {
				comment.remove();
			},
		})
		.transform(source.trim());

	if (invalid) throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, invalid);

	const required = kind === "home" ? "bloggy-posts" : "bloggy-post-content";
	if (counts.get(required) !== 1) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, `The ${kind} template must contain exactly one <${required}></${required}> component.`);
	}
	for (const [name, count] of counts) {
		if (count > 1) throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, `<${name}></${name}> can only appear once.`);
	}

	return sanitized;
}

export function validateCustomization(input: unknown): CreatorCustomizationInput {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION);
	const value = input as Record<string, unknown>;
	if (typeof value.customCss !== "string" || typeof value.homeTemplate !== "string" || typeof value.postTemplate !== "string") {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION);
	}
	if (encoder.encode(value.customCss).byteLength > CUSTOM_CSS_MAX_BYTES) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, `Custom CSS cannot be larger than ${CUSTOM_CSS_MAX_BYTES / 1000} kB.`);
	}

	return {
		customCss: value.customCss.trim(),
		homeTemplate: value.homeTemplate.trim() === "" ? "" : sanitizeTemplate("home", value.homeTemplate),
		postTemplate: value.postTemplate.trim() === "" ? "" : sanitizeTemplate("post", value.postTemplate),
	};
}

export function validateEmbedCustomization(input: unknown): EmbedCustomizationInput {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION);
	const value = input as Record<string, unknown>;
	const options = [
		"showTitle",
		"showDescription",
		"showSearch",
		"showSocial",
		"showAuthor",
		"showDate",
		"showReadTime",
		"showPostDescriptions",
		"showShare",
	] as const;
	if (options.some((option) => typeof value[option] !== "boolean") || typeof value.customCss !== "string") {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, "Embed settings must include each display option and custom CSS.");
	}
	if (!EMBED_DATE_FORMATS.some((format) => format.value === value.dateFormat)) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, "Choose a supported embed date format.");
	}
	if (typeof value.postsPerRow !== "number" || !Number.isInteger(value.postsPerRow) || value.postsPerRow < 0 || value.postsPerRow > 100) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, "Posts per row must be a whole number from 0 to 100. Use 0 for Auto.");
	}
	if (encoder.encode(value.customCss as string).byteLength > CUSTOM_CSS_MAX_BYTES) {
		throw new ApiError(ErrorCode.INVALID_CUSTOMIZATION, `Embed CSS cannot be larger than ${CUSTOM_CSS_MAX_BYTES / 1000} kB.`);
	}
	return {
		showTitle: value.showTitle as boolean,
		showDescription: value.showDescription as boolean,
		showSearch: value.showSearch as boolean,
		showSocial: value.showSocial as boolean,
		showAuthor: value.showAuthor as boolean,
		showDate: value.showDate as boolean,
		showReadTime: value.showReadTime as boolean,
		dateFormat: value.dateFormat as EmbedCustomizationInput["dateFormat"],
		postsPerRow: value.postsPerRow as number,
		showPostDescriptions: value.showPostDescriptions as boolean,
		showShare: value.showShare as boolean,
		customCss: (value.customCss as string).trim(),
	};
}

export function renderTemplate(source: string, values: Record<string, string>): string {
	let rewriter = new HTMLRewriter();
	for (const [component, html] of Object.entries(values)) {
		rewriter = rewriter.on(component, {
			element(element) {
				element.replace(html, { html: true });
			},
		});
	}
	return rewriter.transform(source);
}

export function styleContent(css: string): string {
	return css.replace(/<\/style/gi, "<\\/style");
}
