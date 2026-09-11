import { isMysqlFamily, now, sql, today } from "./index.ts";
import type { PostStatus } from "../../shared/constants.ts";

export interface PostRow {
	username: string;
	slug: string;
	title: string;
	description: string;
	picture: string;
	markdown: string;
	category: string;
	language: string;
	tag: string;
	keywords: string;
	word_count: number;
	read_time: number;
	status: PostStatus;
	created_at: string;
	published_at: string | null;
	updated_at: string;
}

export type PostSummaryRow = Omit<PostRow, "markdown">;

export interface PostInput {
	slug: string;
	title: string;
	description: string;
	picture: string;
	markdown: string;
	category: string;
	language: string;
	tag: string;
	keywords: string;
	status: PostStatus;
}

export interface Post {
	slug: string;
	title: string;
	description: string;
	picture: string;
	markdown: string;
	category: string;
	language: string;
	tag: string;
	keywords: string[];
	wordCount: number;
	readTime: number;
	status: PostStatus;
	createdAt: string;
	publishedAt: string | null;
	updatedAt: string;
}

export function toPublicPost(row: PostRow): Post {
	return {
		slug: row.slug,
		title: row.title,
		description: row.description,
		picture: row.picture,
		markdown: row.markdown,
		category: row.category,
		language: row.language,
		tag: row.tag,
		keywords: row.keywords
			.split(",")
			.map((k) => k.trim())
			.filter((k) => k.length > 0),
		wordCount: row.word_count,
		readTime: row.read_time,
		status: row.status,
		createdAt: row.created_at,
		publishedAt: row.published_at,
		updatedAt: row.updated_at,
	};
}

export function toPublicSummary(row: PostSummaryRow): Omit<Post, "markdown"> {
	const { markdown, ...rest } = toPublicPost({ ...row, markdown: "" });
	return rest;
}

export async function findPost(username: string, slug: string): Promise<PostRow | null> {
	const rows = (await sql`SELECT * FROM posts WHERE username = ${username} AND slug = ${slug}`) as PostRow[];
	return rows[0] ?? null;
}

export async function findPublishedPost(username: string, slug: string): Promise<PostRow | null> {
	const rows = (await sql`SELECT * FROM posts
		WHERE username = ${username} AND slug = ${slug} AND status = 'published'`) as PostRow[];
	return rows[0] ?? null;
}

export async function postExists(username: string, slug: string): Promise<boolean> {
	const rows = (await sql`SELECT slug FROM posts WHERE username = ${username} AND slug = ${slug}`) as { slug: string }[];
	return rows.length > 0;
}

export async function listPostsByCreator(username: string): Promise<PostRow[]> {
	return (await sql`SELECT * FROM posts WHERE username = ${username}
		ORDER BY COALESCE(published_at, created_at) DESC`) as PostRow[];
}

export interface PostFilter {
	tag?: string;
	search?: string;
}

/**
 * `!` rather than the conventional backslash, because MySQL also treats a
 * backslash as an escape inside string literals, so `ESCAPE '\'` would mean
 * different things across the four supported dialects.
 *
 * The `ESCAPE` clauses below spell it out again as a literal, since not every
 * driver accepts a bind parameter there. The two must agree.
 */
const LIKE_ESCAPE = "!";

/**
 * Escapes the LIKE wildcards so the term matches as a literal substring.
 * Without this, searching for `%` would return every post and `_` would match
 * any single character.
 */
function likePattern(value: string): string {
	const escaped = value.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE}${char}`);
	return `%${escaped.toLowerCase()}%`;
}

function filterClause(filter: PostFilter) {
	if (filter.tag !== undefined) return sql`AND tag = ${filter.tag}`;

	if (filter.search !== undefined) {
		const pattern = likePattern(filter.search);
		return sql`AND (LOWER(title) LIKE ${pattern} ESCAPE '!'
			OR LOWER(tag) LIKE ${pattern} ESCAPE '!'
			OR LOWER(keywords) LIKE ${pattern} ESCAPE '!')`;
	}

	return sql``;
}

export async function listPublishedByCreator(username: string, limit = 50, offset = 0, filter: PostFilter = {}): Promise<PostSummaryRow[]> {
	return (await sql`SELECT username, slug, title, description, picture, category, language, tag, keywords,
			word_count, read_time, status, created_at, published_at, updated_at
		FROM posts
		WHERE username = ${username} AND status = 'published'
		${filterClause(filter)}
		ORDER BY published_at DESC
		LIMIT ${limit} OFFSET ${offset}`) as PostSummaryRow[];
}

export async function countPublishedByCreator(username: string, filter: PostFilter = {}): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM posts
		WHERE username = ${username} AND status = 'published'
		${filterClause(filter)}`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}

export async function listRecentPosts(limit = 50): Promise<PostSummaryRow[]> {
	return (await sql`SELECT username, slug, title, description, picture, category, language, tag, keywords,
			word_count, read_time, status, created_at, published_at, updated_at
		FROM posts
		WHERE status = 'published'
		ORDER BY published_at DESC
		LIMIT ${limit}`) as PostSummaryRow[];
}

export async function listAllPostRefs(): Promise<{ username: string; slug: string; updated_at: string }[]> {
	return (await sql`SELECT p.username, p.slug, p.updated_at FROM posts p
		JOIN creators c ON c.username = p.username
		WHERE p.status = 'published' AND c.suspended_at IS NULL
		ORDER BY p.published_at DESC`) as {
		username: string;
		slug: string;
		updated_at: string;
	}[];
}

export async function insertPost(username: string, input: PostInput, wordCount: number, readTime: number): Promise<void> {
	const timestamp = now();
	await sql`INSERT INTO posts ${sql({
		username,
		slug: input.slug,
		title: input.title,
		description: input.description,
		picture: input.picture,
		markdown: input.markdown,
		category: input.category,
		language: input.language,
		tag: input.tag,
		keywords: input.keywords,
		word_count: wordCount,
		read_time: readTime,
		status: input.status,
		created_at: timestamp,
		published_at: input.status === "published" ? timestamp : null,
		updated_at: timestamp,
	})}`;
}

/**
 * `created_at` is left alone so the original creation date survives edits.
 * `published_at` is set the first time a post goes public and then never
 * moves, so re-publishing a correction does not push the post back to the top
 * of every feed.
 */
export async function updatePost(
	username: string,
	input: PostInput,
	wordCount: number,
	readTime: number,
	previous: Pick<PostRow, "status" | "published_at">,
): Promise<void> {
	const goingPublic = input.status === "published" && previous.published_at === null;

	await sql`UPDATE posts SET ${sql({
		title: input.title,
		description: input.description,
		picture: input.picture,
		markdown: input.markdown,
		category: input.category,
		language: input.language,
		tag: input.tag,
		keywords: input.keywords,
		word_count: wordCount,
		read_time: readTime,
		status: input.status,
		published_at: goingPublic ? now() : previous.published_at,
		updated_at: now(),
	})} WHERE username = ${username} AND slug = ${input.slug}`;
}

export async function deletePost(username: string, slug: string): Promise<void> {
	await sql`DELETE FROM posts WHERE username = ${username} AND slug = ${slug}`;
}

export async function deletePostsByCreator(username: string): Promise<void> {
	await sql`DELETE FROM posts WHERE username = ${username}`;
}

export async function countPosts(): Promise<number> {
	const rows = (await sql`SELECT COUNT(*) AS total FROM posts WHERE status = 'published'`) as { total: number }[];
	return Number(rows[0]?.total ?? 0);
}
