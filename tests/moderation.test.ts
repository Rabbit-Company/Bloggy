import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import {
	countAdmins,
	findCreator,
	insertCreator,
	isAdmin,
	isSuspended,
	listCreatorOverview,
	listCreatorCategories,
	listCreators,
	setAdmin,
	setSuspended,
	toPublicCreator,
} from "../src/server/db/creators.ts";
import { insertMedia } from "../src/server/db/media.ts";
import { insertPost, listAllPostRefs, type PostInput } from "../src/server/db/posts.ts";
import { createApp } from "../src/server/index.ts";
import { createSession } from "../src/server/auth/sessions.ts";

function account(username: string) {
	return {
		username,
		password: "hash",
		email: `${username}@example.com`,
		title: `${username} blog`,
		description: "A blog description long enough to pass validation rules.",
		author: `${username} person`,
		category: "Business",
		language: "en",
		theme: "dark",
	};
}

function post(slug: string, status: "published" | "draft" = "published"): PostInput {
	return {
		slug,
		title: "A title that is long enough",
		description: "A description long enough to satisfy the validator rules.",
		picture: "cover.png",
		markdown: "# Body",
		category: "Business",
		language: "en",
		tag: "Tag",
		keywords: "a,b,c",
		status,
	};
}

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	await sql`DELETE FROM media`;
	await sql`DELETE FROM posts`;
	await sql`DELETE FROM creators`;

	await insertCreator(account("heavy"));
	await insertCreator(account("light"));
	await insertCreator(account("empty"));

	await insertPost("heavy", post("first"), 100, 1);
	await insertPost("heavy", post("second"), 100, 1);
	await insertPost("heavy", post("hidden", "draft"), 100, 1);
	await insertPost("light", post("only-one"), 100, 1);

	await insertMedia({ id: "h1", username: "heavy", kind: "image", content_type: "image/png", size: 900 });
	await insertMedia({ id: "h2", username: "heavy", kind: "avatar", content_type: "image/png", size: 100 });
	await insertMedia({ id: "l1", username: "light", kind: "image", content_type: "image/png", size: 50 });
});

describe("new accounts", () => {
	test("are neither admin nor suspended", async () => {
		const row = await findCreator("heavy");
		expect(isAdmin(row!)).toBe(false);
		expect(isSuspended(row!)).toBe(false);
	});

	test("expose both states to the panel", async () => {
		const row = await findCreator("heavy");
		const view = toPublicCreator(row!);
		expect(view.isAdmin).toBe(false);
		expect(view.suspendedAt).toBeNull();
	});
});

describe("browser and shared cache policy", () => {
	test("lets shared caches retain anonymous HTML while browsers revalidate it", async () => {
		const response = await createApp().handle(new Request("http://localhost:3000/"));
		const cacheControl = response.headers.get("Cache-Control") ?? "";
		expect(cacheControl).toContain("max-age=0");
		expect(cacheControl).toContain("s-maxage=300");
		expect(cacheControl).toContain("stale-while-revalidate=600");
		expect(response.headers.get("Vary")).toContain("Cookie");
	});

	test("never lets authenticated HTML enter a shared cache", async () => {
		const session = await createSession("light");
		const response = await createApp().handle(new Request("http://localhost:3000/", { headers: { Cookie: `bloggy_session=${session.token}` } }));
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(response.headers.get("Vary")).toContain("Cookie");
	});
});

describe("the moderation table", () => {
	test("counts published posts and drafts separately", async () => {
		const rows = await listCreatorOverview("username", false);
		const heavy = rows.find((r) => r.username === "heavy");
		expect(heavy?.posts).toBe(2);
		expect(heavy?.drafts).toBe(1);
	});

	// Joining posts and media at once multiplies their rows together, which
	// would report 3 posts and 3000 bytes here instead of 2 and 1000.
	test("does not multiply posts by images", async () => {
		const rows = await listCreatorOverview("username", false);
		const heavy = rows.find((r) => r.username === "heavy");
		expect(heavy?.posts).toBe(2);
		expect(heavy?.storage).toBe(1000);
	});

	test("counts the avatar in storage", async () => {
		const rows = await listCreatorOverview("username", false);
		expect(rows.find((r) => r.username === "heavy")?.storage).toBe(1000);
		expect(rows.find((r) => r.username === "light")?.storage).toBe(50);
	});

	test("reports zero rather than null for an account with nothing", async () => {
		const rows = await listCreatorOverview("username", false);
		const empty = rows.find((r) => r.username === "empty");
		expect(empty?.posts).toBe(0);
		expect(empty?.storage).toBe(0);
	});

	test("sorts by storage, heaviest first", async () => {
		const rows = await listCreatorOverview("storage", true);
		expect(rows.map((r) => r.username)).toEqual(["heavy", "light", "empty"]);
	});

	test("sorts by storage ascending", async () => {
		const rows = await listCreatorOverview("storage", false);
		expect(rows[0]?.username).toBe("empty");
	});

	test("sorts by post count", async () => {
		const rows = await listCreatorOverview("posts", true);
		expect(rows[0]?.username).toBe("heavy");
	});

	test("pages", async () => {
		const first = await listCreatorOverview("storage", true, 1, 0);
		const second = await listCreatorOverview("storage", true, 1, 1);
		expect(first).toHaveLength(1);
		expect(first[0]?.username).toBe("heavy");
		expect(second[0]?.username).toBe("light");
	});

	// The sort column cannot be a bind parameter, so it is looked up in an
	// allowlist. An unknown value must fall back rather than reach the query.
	test("falls back to a safe column for an unknown sort", async () => {
		const rows = await listCreatorOverview("storage; DROP TABLE creators" as never, true);
		expect(rows).toHaveLength(3);
		expect(await findCreator("heavy")).not.toBeNull();
	});

	test("includes suspended accounts, which is the point of the table", async () => {
		await setSuspended("light", true);
		const rows = await listCreatorOverview("username", false);
		expect(rows.map((r) => r.username)).toContain("light");
		expect(rows.find((r) => r.username === "light")?.suspendedAt).not.toBeNull();
	});
});

describe("suspension", () => {
	test("filters the public directory by creator category", async () => {
		await sql`UPDATE creators SET category = ${"Technology"} WHERE username = ${"light"}`;
		expect((await listCreators(100, "Technology")).map((c) => c.username)).toEqual(["light"]);
		expect((await listCreators(100, "Business")).map((c) => c.username)).not.toContain("light");
	});

	test("only lists categories represented by public creators", async () => {
		await sql`UPDATE creators SET category = ${"Technology"} WHERE username = ${"light"}`;
		expect(await listCreatorCategories()).toEqual(["Business", "Technology"]);

		await setSuspended("light", true);
		expect(await listCreatorCategories()).toEqual(["Business"]);
	});

	test("records when, and lifting clears it", async () => {
		await setSuspended("light", true);
		expect(isSuspended((await findCreator("light"))!)).toBe(true);

		await setSuspended("light", false);
		expect(isSuspended((await findCreator("light"))!)).toBe(false);
	});

	test("hides the account from the public directory", async () => {
		expect((await listCreators()).map((c) => c.username)).toContain("light");
		await setSuspended("light", true);
		expect((await listCreators()).map((c) => c.username)).not.toContain("light");
	});

	test("takes the account's posts out of the sitemap", async () => {
		expect((await listAllPostRefs()).some((r) => r.username === "light")).toBe(true);
		await setSuspended("light", true);
		expect((await listAllPostRefs()).some((r) => r.username === "light")).toBe(false);
	});

	test("hides posts from suspended and unverified creators in the public JSON API", async () => {
		await setSuspended("light", true);
		await sql`UPDATE creators SET email_verified_at = NULL WHERE username = ${"heavy"}`;

		const app = createApp();
		const suspended = await app.handle(new Request("http://localhost:3000/api/v1/creators/light/posts/only-one"));
		const unverified = await app.handle(new Request("http://localhost:3000/api/v1/creators/heavy/posts/first"));

		expect(suspended.status).toBe(404);
		expect(unverified.status).toBe(404);
	});

	test("leaves other accounts in the sitemap", async () => {
		await setSuspended("light", true);
		expect((await listAllPostRefs()).some((r) => r.username === "heavy")).toBe(true);
	});

	// Posts keep their status, so restoring republishes exactly what was public
	// before rather than exposing drafts.
	test("does not change post status", async () => {
		await setSuspended("heavy", true);
		await setSuspended("heavy", false);

		const refs = await listAllPostRefs();
		const slugs = refs.filter((r) => r.username === "heavy").map((r) => r.slug);
		expect(slugs.sort()).toEqual(["first", "second"]);
	});
});

describe("admin flag", () => {
	test("is granted and revoked", async () => {
		await setAdmin("light", true);
		expect(isAdmin((await findCreator("light"))!)).toBe(true);

		await setAdmin("light", false);
		expect(isAdmin((await findCreator("light"))!)).toBe(false);
	});

	test("countAdmins tracks the total", async () => {
		expect(await countAdmins()).toBe(0);
		await setAdmin("light", true);
		expect(await countAdmins()).toBe(1);
		await setAdmin("heavy", true);
		expect(await countAdmins()).toBe(2);
	});
});
