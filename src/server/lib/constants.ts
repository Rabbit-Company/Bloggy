import { SOCIAL_PLATFORMS } from "../../shared/constants.ts";

export {
	BACKUP_CODE_COUNT,
	CATEGORIES,
	DEFAULT_THEME_COLORS,
	LANGUAGES,
	POST_MAX_MARKDOWN_BYTES,
	POST_MAX_WORDS,
	POST_MIN_WORDS,
	POST_STATUSES,
	SOCIAL_PLATFORMS,
	SUPPORTED_IMAGE_TYPES,
	THEMES,
	WORDS_PER_MINUTE,
} from "../../shared/constants.ts";

export type { Category, Language, SocialPlatform, Theme } from "../../shared/constants.ts";

export const SOCIAL_PREFIXES: Record<string, string | null> = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform.key, platform.prefix]));

export const SOCIAL_LABELS: Record<string, string> = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform.key, platform.label]));

export const IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/svg+xml": "svg",
	"image/webp": "webp",
};
