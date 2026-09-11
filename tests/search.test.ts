import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { countPublishedByCreator, insertPost, listPublishedByCreator, type PostInput } from "../src/server/db/posts.ts";

const USERNAME = "searcher";

function post(overrides: Partial<PostInput> & Pick<PostInput, "slug" | "title">): PostInput {
	return {
		description: "A description long enough to satisfy the validator rules.",
		picture: "cover.png",
		markdown: "# Body",
		category: "technology",
		language: "en",
		tag: "Bun",
		keywords: "alpha,beta,gamma",
		status: "published",
		...overrides,
	};
}

beforeAll(async () => {
	await migrate();

	await sql`INSERT INTO creators ${sql({
		username: USERNAME,
		password: "x",
		email: "s@example.com",
		totp_secret: null,
		backup_codes: null,
		title: "Search Blog",
		description: "A blog used by the search tests, long enough to be valid.",
		author: "Search Author",
		category: "technology",
		language: "en",
		social: "{}",
		theme: "auto",
		avatar_type: "image/png",
		created_at: new Date().toISOString(),
		accessed_at: new Date().toISOString(),
	})}`;

	const posts: PostInput[] = [
		post({ slug: "bun-native-sql", title: "Hello from Bun and native SQL", tag: "Bun", keywords: "bun,sql,markdown" }),
		post({ slug: "cooking-rice", title: "Cooking rice properly", tag: "Food", keywords: "rice,food,kitchen" }),
		post({ slug: "hundred-percent", title: "100% pure profit", tag: "Money", keywords: "cash,profit,gain" }),
		post({ slug: "snake_case-post", title: "On snake_case naming", tag: "Style", keywords: "naming,code,style" }),
		post({ slug: "hidden-draft", title: "A draft nobody should see", tag: "Bun", keywords: "secret,draft,hidden", status: "draft" }),
	];
	for (const entry of posts) await insertPost(USERNAME, entry, 100, 1);
});

const slugs = async (filter: Parameters<typeof listPublishedByCreator>[3]) =>
	(await listPublishedByCreator(USERNAME, 50, 0, filter)).map((row) => row.slug).sort();

describe("tag filter", () => {
	test("matches a tag exactly", async () => {
		expect(await slugs({ tag: "Food" })).toEqual(["cooking-rice"]);
	});

	test("never returns a draft", async () => {
		expect(await slugs({ tag: "Bun" })).toEqual(["bun-native-sql"]);
	});

	test("is not a substring match", async () => {
		expect(await slugs({ tag: "Foo" })).toEqual([]);
	});

	test("an unknown tag returns nothing", async () => {
		expect(await slugs({ tag: "Nonexistent" })).toEqual([]);
	});
});

describe("search filter", () => {
	test("matches the title", async () => {
		expect(await slugs({ search: "cooking" })).toEqual(["cooking-rice"]);
	});

	test("is case-insensitive", async () => {
		expect(await slugs({ search: "COOKING" })).toEqual(["cooking-rice"]);
	});

	test("matches a keyword", async () => {
		expect(await slugs({ search: "kitchen" })).toEqual(["cooking-rice"]);
	});

	test("matches a tag", async () => {
		expect(await slugs({ search: "money" })).toEqual(["hundred-percent"]);
	});

	test("matches a substring mid-word", async () => {
		expect(await slugs({ search: "ative" })).toEqual(["bun-native-sql"]);
	});

	test("never returns a draft", async () => {
		expect(await slugs({ search: "draft" })).toEqual([]);
	});

	test("treats % as a literal, not a wildcard", async () => {
		expect(await slugs({ search: "100%" })).toEqual(["hundred-percent"]);
	});

	test("treats _ as a literal, not a single-character wildcard", async () => {
		expect(await slugs({ search: "snake_case" })).toEqual(["snake_case-post"]);
	});

	test("a _ wildcard would have matched but does not", async () => {
		expect(await slugs({ search: "snake_ase" })).toEqual([]);
	});

	test("treats the ! escape character as a literal", async () => {
		expect(await slugs({ search: "!" })).toEqual([]);
	});

	test("a quote does not break the query", async () => {
		expect(await slugs({ search: "' OR '1'='1" })).toEqual([]);
	});

	test("no match returns nothing", async () => {
		expect(await slugs({ search: "zzzznothing" })).toEqual([]);
	});
});

describe("unfiltered listing", () => {
	test("returns every published post and no draft", async () => {
		expect(await slugs({})).toEqual(["bun-native-sql", "cooking-rice", "hundred-percent", "snake_case-post"]);
	});

	test("counts match the filtered listing", async () => {
		expect(await countPublishedByCreator(USERNAME)).toBe(4);
		expect(await countPublishedByCreator(USERNAME, { tag: "Bun" })).toBe(1);
		expect(await countPublishedByCreator(USERNAME, { search: "100%" })).toBe(1);
	});
});
