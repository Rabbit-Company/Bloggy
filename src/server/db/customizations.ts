import { isMysqlFamily, now, sql } from "./index.ts";

export interface CreatorCustomization {
	customCss: string;
	homeTemplate: string;
	postTemplate: string;
	updatedAt: string | null;
}

interface CustomizationRow {
	username: string;
	custom_css: string;
	home_template: string;
	post_template: string;
	updated_at: string;
}

export const EMPTY_CUSTOMIZATION: CreatorCustomization = {
	customCss: "",
	homeTemplate: "",
	postTemplate: "",
	updatedAt: null,
};

export async function findCustomization(username: string): Promise<CreatorCustomization> {
	const rows = (await sql`SELECT * FROM creator_customizations WHERE username = ${username}`) as CustomizationRow[];
	const row = rows[0];
	if (!row) return { ...EMPTY_CUSTOMIZATION };
	return {
		customCss: row.custom_css,
		homeTemplate: row.home_template,
		postTemplate: row.post_template,
		updatedAt: row.updated_at,
	};
}

export async function saveCustomization(username: string, customization: Omit<CreatorCustomization, "updatedAt">): Promise<CreatorCustomization> {
	const timestamp = now();
	if (isMysqlFamily) {
		await sql`INSERT INTO creator_customizations (username, custom_css, home_template, post_template, updated_at)
			VALUES (${username}, ${customization.customCss}, ${customization.homeTemplate}, ${customization.postTemplate}, ${timestamp})
			ON DUPLICATE KEY UPDATE
				custom_css = ${customization.customCss},
				home_template = ${customization.homeTemplate},
				post_template = ${customization.postTemplate},
				updated_at = ${timestamp}`;
	} else {
		await sql`INSERT INTO creator_customizations (username, custom_css, home_template, post_template, updated_at)
			VALUES (${username}, ${customization.customCss}, ${customization.homeTemplate}, ${customization.postTemplate}, ${timestamp})
			ON CONFLICT (username) DO UPDATE SET
				custom_css = excluded.custom_css,
				home_template = excluded.home_template,
				post_template = excluded.post_template,
				updated_at = excluded.updated_at`;
	}

	return { ...customization, updatedAt: timestamp };
}

export async function deleteCustomization(username: string): Promise<void> {
	await sql`DELETE FROM creator_customizations WHERE username = ${username}`;
}
