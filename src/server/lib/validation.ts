import {
	CATEGORIES,
	LANGUAGES,
	POST_MAX_MARKDOWN_BYTES,
	POST_MAX_WORDS,
	POST_MIN_WORDS,
	POST_STATUSES,
	SOCIAL_PREFIXES,
	SUPPORTED_IMAGE_TYPES,
	THEMES,
	WORDS_PER_MINUTE,
} from "./constants.ts";
import type { PostStatus } from "../../shared/constants.ts";
import { ApiError, ErrorCode } from "./errors.ts";

const categorySet: ReadonlySet<string> = new Set(CATEGORIES);
const languageSet: ReadonlySet<string> = new Set(LANGUAGES);
const themeSet: ReadonlySet<string> = new Set(THEMES.map((theme) => theme.value));
const imageTypeSet: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_TYPES);
const statusSet: ReadonlySet<string> = new Set(POST_STATUSES);

export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function wordCount(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
}

export function readTime(words: number): number {
	return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function isUsernameValid(value: unknown): value is string {
	return isString(value) && /^[a-z][a-z0-9-]{3,29}$/.test(value);
}

export function isEmailValid(value: unknown): value is string {
	if (!isString(value) || value.length > 320) return false;
	return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

export function isPasswordValid(value: unknown): value is string {
	return isString(value) && value.length >= 8 && value.length <= 256;
}

export function isOtpValid(value: unknown): value is string {
	return isString(value) && (/^\d{6}$/.test(value) || /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value));
}

export function isTitleValid(value: unknown): value is string {
	return isString(value) && value.length >= 3 && value.length <= 30;
}

export function isDescriptionValid(value: unknown): value is string {
	return isString(value) && value.length >= 30 && value.length <= 160;
}

export function isAuthorValid(value: unknown): value is string {
	return isString(value) && value.length >= 5 && value.length <= 30;
}

export function isCategoryValid(value: unknown): value is string {
	return isString(value) && categorySet.has(value);
}

export function isLanguageValid(value: unknown): value is string {
	return isString(value) && languageSet.has(value);
}

export function isThemeValid(value: unknown): value is string {
	return isString(value) && themeSet.has(value);
}

export function isImageTypeSupported(value: unknown): value is string {
	return isString(value) && imageTypeSet.has(value);
}

export function isUrlValid(value: unknown): value is string {
	if (!isString(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

export function isSocialValid(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > Object.keys(SOCIAL_PREFIXES).length) return false;

	for (const [platform, url] of entries) {
		if (!(platform in SOCIAL_PREFIXES)) return false;

		if (platform === "email") {
			if (!isEmailValid(url)) return false;
			continue;
		}

		if (!isUrlValid(url)) return false;

		const prefix = SOCIAL_PREFIXES[platform];
		if (typeof prefix === "string" && !url.startsWith(prefix)) return false;
	}

	return true;
}

export function isSlugValid(value: unknown): value is string {
	return isString(value) && /^[a-z][a-z0-9-]{4,99}$/.test(value);
}

export function isPostTitleValid(value: unknown): value is string {
	return isString(value) && value.length >= 5 && value.length <= 100;
}

export function isPostDescriptionValid(value: unknown): value is string {
	return isString(value) && value.length >= 30 && value.length <= 300;
}

export function isPostPictureValid(value: unknown): value is string {
	return isString(value) && value.length >= 5 && value.length <= 500;
}

export function isPostTagValid(value: unknown): value is string {
	return isString(value) && value.length >= 3 && value.length <= 30;
}

export function isPostKeywordsValid(value: unknown): value is string {
	if (!isString(value) || value.length >= 255) return false;
	const keywords = value
		.split(",")
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
	return keywords.length >= 3 && keywords.length <= 20;
}

export function isPostMarkdownValid(value: unknown): value is string {
	if (!isString(value) || value.length > POST_MAX_MARKDOWN_BYTES) return false;
	const words = wordCount(value);
	return words >= POST_MIN_WORDS && words <= POST_MAX_WORDS;
}

export function isPostStatusValid(value: unknown): value is PostStatus {
	return isString(value) && statusSet.has(value);
}

export function isDraftTitleValid(value: unknown): value is string {
	return isString(value) && value.trim().length >= 1 && value.length <= 100;
}

export function isDraftTextValid(maxLength: number): (value: unknown) => value is string {
	return (value: unknown): value is string => isString(value) && value.length <= maxLength;
}

export function isDraftMarkdownValid(value: unknown): value is string {
	return isString(value) && value.length <= POST_MAX_MARKDOWN_BYTES;
}

export function isUuidValid(value: unknown): value is string {
	return isString(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function assertValid<T>(value: unknown, predicate: (v: unknown) => v is T, code: ErrorCode): asserts value is T {
	if (!predicate(value)) throw new ApiError(code);
}
