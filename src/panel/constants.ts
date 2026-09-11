import type { PublicConfig } from "../shared/constants.ts";

export { CATEGORIES, COMMON_LANGUAGES as LANGUAGES, PANEL_BASE, SOCIAL_PLATFORMS, THEMES, POST_MAX_WORDS, POST_MIN_WORDS } from "../shared/constants.ts";

let instance: PublicConfig = {
	registrationEnabled: true,
	minPasswordEntropy: 75,
	maxAvatarSize: 300_000,
	maxImageSize: 1_000_000,
	maxAccountStorage: 100_000_000,
	siteTitle: "Bloggy",
	analytics: "none",
};

export function instanceConfig(): PublicConfig {
	return instance;
}

export function setInstanceConfig(value: PublicConfig): void {
	instance = value;
}
