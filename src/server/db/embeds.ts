import { DEFAULT_EMBED_CUSTOMIZATION, type EmbedCustomizationInput } from "../../shared/embed.ts";
import { isMysqlFamily, now, sql } from "./index.ts";

export interface EmbedCustomization extends EmbedCustomizationInput {
	updatedAt: string | null;
}

interface EmbedRow {
	show_title: number;
	show_description: number;
	show_search: number;
	show_social: number;
	show_author: number;
	show_post_descriptions: number;
	show_share: number;
	custom_css: string;
	updated_at: string;
}

export async function findEmbedCustomization(username: string): Promise<EmbedCustomization> {
	const rows = (await sql`SELECT * FROM creator_embeds WHERE username = ${username}`) as EmbedRow[];
	const row = rows[0];
	if (!row) return { ...DEFAULT_EMBED_CUSTOMIZATION, updatedAt: null };
	return {
		showTitle: Number(row.show_title) === 1,
		showDescription: Number(row.show_description) === 1,
		showSearch: Number(row.show_search) === 1,
		showSocial: Number(row.show_social) === 1,
		showAuthor: Number(row.show_author) === 1,
		showPostDescriptions: Number(row.show_post_descriptions) === 1,
		showShare: Number(row.show_share) === 1,
		customCss: row.custom_css,
		updatedAt: row.updated_at,
	};
}

export async function saveEmbedCustomization(username: string, value: EmbedCustomizationInput): Promise<EmbedCustomization> {
	const timestamp = now();
	const title = Number(value.showTitle);
	const description = Number(value.showDescription);
	const search = Number(value.showSearch);
	const social = Number(value.showSocial);
	const author = Number(value.showAuthor);
	const postDescriptions = Number(value.showPostDescriptions);
	const share = Number(value.showShare);
	if (isMysqlFamily) {
		await sql`INSERT INTO creator_embeds (username, show_title, show_description, show_search, show_social, show_author, show_post_descriptions, show_share, custom_css, updated_at)
			VALUES (${username}, ${title}, ${description}, ${search}, ${social}, ${author}, ${postDescriptions}, ${share}, ${value.customCss}, ${timestamp})
			ON DUPLICATE KEY UPDATE
				show_title = ${title}, show_description = ${description}, show_search = ${search}, show_social = ${social},
				show_author = ${author}, show_post_descriptions = ${postDescriptions}, show_share = ${share},
				custom_css = ${value.customCss}, updated_at = ${timestamp}`;
	} else {
		await sql`INSERT INTO creator_embeds (username, show_title, show_description, show_search, show_social, show_author, show_post_descriptions, show_share, custom_css, updated_at)
			VALUES (${username}, ${title}, ${description}, ${search}, ${social}, ${author}, ${postDescriptions}, ${share}, ${value.customCss}, ${timestamp})
			ON CONFLICT (username) DO UPDATE SET
				show_title = excluded.show_title, show_description = excluded.show_description, show_search = excluded.show_search,
				show_social = excluded.show_social, show_author = excluded.show_author,
				show_post_descriptions = excluded.show_post_descriptions, show_share = excluded.show_share,
				custom_css = excluded.custom_css, updated_at = excluded.updated_at`;
	}
	return { ...value, updatedAt: timestamp };
}

export async function deleteEmbedCustomization(username: string): Promise<void> {
	await sql`DELETE FROM creator_embeds WHERE username = ${username}`;
}
