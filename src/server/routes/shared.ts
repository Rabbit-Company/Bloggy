import { ErrorCode } from "../lib/errors.ts";
import { assertValid, isAuthorValid, isCategoryValid, isDescriptionValid, isLanguageValid, isThemeValid, isTitleValid } from "../lib/validation.ts";
import type { CreatorSettings } from "../db/creators.ts";

export function validateSettings(body: Record<string, unknown>): CreatorSettings {
	assertValid(body.title, isTitleValid, ErrorCode.INVALID_TITLE);
	assertValid(body.description, isDescriptionValid, ErrorCode.INVALID_DESCRIPTION);
	assertValid(body.author, isAuthorValid, ErrorCode.INVALID_AUTHOR);
	assertValid(body.category, isCategoryValid, ErrorCode.INVALID_CATEGORY);
	assertValid(body.language, isLanguageValid, ErrorCode.INVALID_LANGUAGE);
	assertValid(body.theme, isThemeValid, ErrorCode.INVALID_THEME);

	return {
		title: body.title,
		description: body.description,
		author: body.author,
		category: body.category,
		language: body.language,
		theme: body.theme,
	};
}
