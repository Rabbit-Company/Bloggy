export interface EmbedCustomizationInput {
	showTitle: boolean;
	showDescription: boolean;
	showSearch: boolean;
	showSocial: boolean;
	showAuthor: boolean;
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
	showPostDescriptions: false,
	showShare: false,
	customCss: "",
};
