import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { findCreator, insertCreator } from "../src/server/db/creators.ts";
import { insertMedia, listMedia, listMediaByCreator, mediaUsage } from "../src/server/db/media.ts";
import { avatarKey, imageKey, storage } from "../src/server/lib/storage.ts";
import { recordAvatar, syncMediaFromStorage } from "../src/server/lib/media-sync.ts";
import { replaceAvatarMedia } from "../src/server/db/media.ts";

const USER = "legacy";
const OTHER = "someoneelse";

// Ids as the original Bloggy wrote them: uuidv4, no extension.
const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-8999-aaaaaaaaaaaa";

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

/**
 * Real PNG bytes padded to a size. Media keys carry no extension, so the local
 * driver cannot name the type and the sync has to recover it from the content.
 */
function png(size: number): Uint8Array {
	const data = new Uint8Array(size).fill(7);
	data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	return data;
}

const notAnImage = (size: number) => new Uint8Array(size).fill(7);

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	await rm("./data/test-media", { recursive: true, force: true });
	await sql`DELETE FROM media`;
	await sql`DELETE FROM creators`;
	await insertCreator(account(USER));
	await insertCreator(account(OTHER));
});

describe("importing a bucket the database has never seen", () => {
	test("records every object and reports the usage", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await storage.put(imageKey(USER, B), png(600), "image/webp");

		const result = await syncMediaFromStorage(USER);

		expect(result.imported).toBe(2);
		expect(result.pruned).toBe(0);
		expect(result.usage).toBe(1000);
		expect(await mediaUsage(USER)).toBe(1000);
	});

	test("the images then appear in the creator's own listing", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await syncMediaFromStorage(USER);

		const listed = await listMedia(USER, "image");
		expect(listed.map((row) => row.id)).toEqual([A]);
	});

	test("recovers the content type from the object's own bytes", async () => {
		await storage.put(imageKey(USER, A), png(64), "image/png");
		await syncMediaFromStorage(USER);

		expect((await listMedia(USER, "image"))[0]?.content_type).toBe("image/png");
	});

	// Recording "application/octet-stream" as an avatar type is truthy, so it
	// beats the fallback in the media route and leaves the avatar unrenderable.
	test("leaves avatar_type unset when the type cannot be determined", async () => {
		await storage.put(avatarKey(USER), notAnImage(40), "application/octet-stream");
		await syncMediaFromStorage(USER);

		expect((await findCreator(USER))?.avatar_type).toBeNull();
	});

	test("imports the avatar and records its type on the creator", async () => {
		await storage.put(avatarKey(USER), png(250), "image/png");

		const result = await syncMediaFromStorage(USER);

		expect(result.imported).toBe(1);
		expect(result.usage).toBe(250);
		expect((await findCreator(USER))?.avatar_type).toBe("image/png");
	});

	test("never touches another creator's objects", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await storage.put(imageKey(OTHER, B), png(999), "image/png");

		await syncMediaFromStorage(USER);

		expect(await mediaUsage(USER)).toBe(400);
		expect(await mediaUsage(OTHER)).toBe(0);
	});

	test("an empty bucket is not an error", async () => {
		const result = await syncMediaFromStorage(USER);
		expect(result).toMatchObject({ imported: 0, pruned: 0, usage: 0 });
	});
});

describe("running it again", () => {
	test("is idempotent", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");

		const first = await syncMediaFromStorage(USER);
		const second = await syncMediaFromStorage(USER);

		expect(first.imported).toBe(1);
		expect(second.imported).toBe(0);
		expect(second.pruned).toBe(0);
		expect(await listMediaByCreator(USER)).toHaveLength(1);
	});

	test("does not duplicate the avatar", async () => {
		await storage.put(avatarKey(USER), png(250), "image/png");
		await syncMediaFromStorage(USER);
		await syncMediaFromStorage(USER);

		expect(await listMedia(USER, "avatar")).toHaveLength(1);
		expect(await mediaUsage(USER)).toBe(250);
	});

	test("corrects a size that drifted from the object", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await syncMediaFromStorage(USER);

		await sql`UPDATE media SET size = 999999 WHERE id = ${A}`;
		const result = await syncMediaFromStorage(USER);

		expect(result.usage).toBe(400);
		expect(await mediaUsage(USER)).toBe(400);
	});
});

describe("objects that have gone", () => {
	test("a row whose object was removed behind the app's back is pruned", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await storage.put(imageKey(USER, B), png(600), "image/png");
		await syncMediaFromStorage(USER);

		await storage.delete(imageKey(USER, B));
		const result = await syncMediaFromStorage(USER);

		expect(result.pruned).toBe(1);
		expect(await mediaUsage(USER)).toBe(400);
	});
});

describe("keys that cannot be served", () => {
	// The serving route validates the id as a UUID, so a legacy object with any
	// other name would be recorded but unreachable. It is reported instead.
	test("a non-uuid object is skipped and named", async () => {
		await storage.put(imageKey(USER, "cover.png"), png(100), "image/png");
		await storage.put(imageKey(USER, A), png(400), "image/png");

		const result = await syncMediaFromStorage(USER);

		expect(result.imported).toBe(1);
		expect(result.skipped).toEqual([`images/${USER}/cover.png`]);
		expect(result.usage).toBe(400);
	});
});

describe("deleting an image", () => {
	// Deletion has to reach the bucket, or the object survives every future
	// sync and reappears in the listing.
	test("removes the stored object, not just the row", async () => {
		await storage.put(imageKey(USER, A), png(400), "image/png");
		await syncMediaFromStorage(USER);

		await storage.delete(imageKey(USER, A));
		expect(await storage.exists(imageKey(USER, A))).toBe(false);

		const result = await syncMediaFromStorage(USER);
		expect(result.pruned).toBe(1);
		expect(await mediaUsage(USER)).toBe(0);
	});
});

// Usage must not move just because someone pressed recalculate. Anything the
// application writes has to be recorded when it writes it, or the number is
// only right after a manual sync.
describe("usage is the same before and after a recalculate", () => {
	test("an account whose avatar was recorded on creation does not change", async () => {
		await storage.put(avatarKey(USER), png(3100), "image/svg+xml");
		await recordAvatar(USER);

		const before = await mediaUsage(USER);
		const result = await syncMediaFromStorage(USER);

		expect(before).toBe(3100);
		expect(result.imported).toBe(0);
		expect(result.usage).toBe(before);
		expect(await mediaUsage(USER)).toBe(before);
	});

	test("an uploaded image does not change", async () => {
		await storage.put(avatarKey(USER), png(3100), "image/png");
		await recordAvatar(USER);
		await storage.put(imageKey(USER, A), png(500), "image/png");
		await insertMedia({ id: A, username: USER, kind: "image", content_type: "image/png", size: 500 });

		const before = await mediaUsage(USER);
		const result = await syncMediaFromStorage(USER);

		expect(before).toBe(3600);
		expect(result.imported).toBe(0);
		expect(result.usage).toBe(before);
	});

	test("replacing the avatar counts the new size, not both", async () => {
		await storage.put(avatarKey(USER), png(3100), "image/png");
		await recordAvatar(USER);

		// What the avatar upload route does: same key, replaced row.
		await storage.put(avatarKey(USER), png(800), "image/png");
		await replaceAvatarMedia(crypto.randomUUID(), USER, "image/png", 800);

		expect(await mediaUsage(USER)).toBe(800);

		const result = await syncMediaFromStorage(USER);
		expect(result.imported).toBe(0);
		expect(result.usage).toBe(800);
		expect(await mediaUsage(USER)).toBe(800);
	});

	test("recording the avatar twice does not double count", async () => {
		await storage.put(avatarKey(USER), png(3100), "image/png");
		await recordAvatar(USER);
		await recordAvatar(USER, (await listMedia(USER, "avatar"))[0]);

		expect(await listMedia(USER, "avatar")).toHaveLength(1);
		expect(await mediaUsage(USER)).toBe(3100);
	});
});
