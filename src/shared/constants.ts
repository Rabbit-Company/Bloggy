export const CATEGORIES = [
	"Art and Design",
	"Book and Writing",
	"Business",
	"Car",
	"DIY Craft",
	"Fashion and Beauty",
	"Finance",
	"Food",
	"Gaming",
	"Health and Fitness",
	"Lifestyle",
	"Movie",
	"Music",
	"News",
	"Parenting",
	"Personal",
	"Pet",
	"Political",
	"Religion",
	"Review",
	"Sports",
	"Technology",
	"Travel",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const THEMES = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

// prettier-ignore
export const LANGUAGES = [
	"ab", "aa", "af", "ak", "sq", "am", "ar", "an", "hy", "as", "av", "ae", "ay", "az",
	"bm", "ba", "eu", "be", "bn", "bh", "bi", "bs", "br", "bg", "my",
	"ca", "km", "ch", "ce", "ny", "zh", "cu", "cv", "kw", "co", "cr", "hr", "cs",
	"da", "dv", "nl", "dz",
	"en", "eo", "et", "ee",
	"fo", "fj", "fi", "fr", "ff",
	"gd", "gl", "lg", "ka", "de", "ki", "el", "kl", "gn", "gu",
	"ht", "ha", "he", "hz", "hi", "ho", "hu",
	"is", "io", "ig", "id", "ia", "ie", "iu", "ik", "ga", "it",
	"ja", "jv",
	"kn", "kr", "ks", "kk", "rw", "kv", "kg", "ko", "kj", "ku", "ky",
	"lo", "la", "lv", "lb", "li", "ln", "lt", "lu",
	"mk", "mg", "ms", "ml", "mt", "gv", "mi", "mr", "mh", "ro", "mn",
	"na", "nv", "nd", "ng", "ne", "se", "no", "nb", "nn", "ii",
	"oc", "oj", "or", "om", "os",
	"pi", "pa", "ps", "fa", "pl", "pt",
	"qu", "rm", "rn", "ru",
	"sm", "sg", "sa", "sc", "sr", "sn", "sd", "si", "sk", "sl", "so", "st", "nr", "es", "su", "sw", "ss", "sv",
	"tl", "ty", "tg", "ta", "tt", "te", "th", "bo", "ti", "to", "ts", "tn", "tr", "tk", "tw",
	"ug", "uk", "ur", "uz",
	"ve", "vi", "vo",
	"wa", "cy", "fy", "wo",
	"xh", "yi", "yo", "za", "zu",
] as const;

export type Language = (typeof LANGUAGES)[number];

export const COMMON_LANGUAGES = [
	{ value: "en", label: "English" },
	{ value: "sl", label: "Slovenian" },
	{ value: "de", label: "German" },
	{ value: "fr", label: "French" },
	{ value: "es", label: "Spanish" },
	{ value: "it", label: "Italian" },
	{ value: "pt", label: "Portuguese" },
	{ value: "nl", label: "Dutch" },
	{ value: "pl", label: "Polish" },
	{ value: "cs", label: "Czech" },
	{ value: "hr", label: "Croatian" },
	{ value: "sr", label: "Serbian" },
	{ value: "ru", label: "Russian" },
	{ value: "uk", label: "Ukrainian" },
	{ value: "tr", label: "Turkish" },
	{ value: "ar", label: "Arabic" },
	{ value: "hi", label: "Hindi" },
	{ value: "zh", label: "Chinese" },
	{ value: "ja", label: "Japanese" },
	{ value: "ko", label: "Korean" },
] as const;

/**
 * `prefix` is the URL the value must start with, or `null` when any valid URL
 * is allowed. Enforcing it stops profile links being used to point somewhere
 * unexpected under the name of a known platform. The server validates against
 * `prefix`, and the panel renders `label` and `placeholder`.
 */
export const SOCIAL_PLATFORMS = [
	{ key: "website", label: "Website", prefix: null, placeholder: "https://example.com" },
	{ key: "email", label: "Email", prefix: null, placeholder: "you@example.com" },
	{ key: "discord", label: "Discord", prefix: "https://discord.gg/", placeholder: "https://discord.gg/invite" },
	{ key: "twitter", label: "Twitter", prefix: "https://twitter.com/", placeholder: "https://twitter.com/handle" },
	{ key: "mastodon", label: "Mastodon", prefix: null, placeholder: "https://mastodon.social/@handle" },
	{ key: "github", label: "GitHub", prefix: "https://github.com/", placeholder: "https://github.com/handle" },
	{ key: "youtube", label: "YouTube", prefix: "https://youtube.com/", placeholder: "https://youtube.com/@handle" },
	{ key: "linkedin", label: "LinkedIn", prefix: "https://linkedin.com/", placeholder: "https://linkedin.com/in/handle" },
	{ key: "instagram", label: "Instagram", prefix: "https://instagram.com/", placeholder: "https://instagram.com/handle" },
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]["key"];

export const POST_STATUSES = ["draft", "published"] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"] as const;

/** Average adult reading speed, used to estimate a post's read time. */
export const WORDS_PER_MINUTE = 200;

export const POST_MIN_WORDS = 150;
export const POST_MAX_WORDS = 10_000;

export const POST_MAX_MARKDOWN_BYTES = 100_000;

export const BACKUP_CODE_COUNT = 10;

export const PANEL_BASE = "/panel";

export interface PublicConfig {
	registrationEnabled: boolean;
	minPasswordEntropy: number;
	maxAvatarSize: number;
	maxImageSize: number;
	/** Total stored bytes allowed per account, or 0 when unlimited. */
	maxAccountStorage: number;
	siteTitle: string;
	analytics: "none" | "burrowgate";
}
