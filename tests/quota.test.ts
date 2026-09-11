import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { config } from "../src/server/config.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { findAvatarMedia, insertMedia, mediaUsage, replaceAvatarMedia } from "../src/server/db/media.ts";
import { assertStorageAvailable, quotaDisabled, storageQuota } from "../src/server/lib/quota.ts";
import { ApiError, ErrorCode } from "../src/server/lib/errors.ts";

const USER = "quotauser";
const LIMIT = 1_000_000;

const original = config.limits.maxAccountStorage;

function setLimit(bytes: number): void {
	(config.limits as { maxAccountStorage: number }).maxAccountStorage = bytes;
}

async function addImage(id: string, size: number): Promise<void> {
	await insertMedia({ id, username: USER, kind: "image", content_type: "image/png", size });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
	try {
		await promise;
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error("expected the call to throw, but it resolved");
}

beforeAll(async () => {
	await migrate();
});

beforeEach(async () => {
	await sql`DELETE FROM media WHERE username = ${USER}`;
	setLimit(LIMIT);
});

describe("usage accounting", () => {
	test("is zero for an account with no media", async () => {
		expect(await mediaUsage(USER)).toBe(0);
	});

	test("sums every stored object", async () => {
		await addImage("a", 400);
		await addImage("b", 600);
		expect(await mediaUsage(USER)).toBe(1000);
	});

	test("drops to zero again once the rows are deleted", async () => {
		await addImage("a", 400);
		await sql`DELETE FROM media WHERE username = ${USER}`;
		expect(await mediaUsage(USER)).toBe(0);
	});

	test("counts the avatar alongside images", async () => {
		await addImage("a", 400);
		await replaceAvatarMedia("av1", USER, "image/png", 250);
		expect(await mediaUsage(USER)).toBe(650);
	});

	test("is not affected by another account's media", async () => {
		await addImage("a", 400);
		await insertMedia({ id: "other", username: "somebodyelse", kind: "image", content_type: "image/png", size: 999_999 });
		expect(await mediaUsage(USER)).toBe(400);
	});
});

describe("avatar replacement", () => {
	test("replaces the row rather than adding one", async () => {
		await replaceAvatarMedia("av1", USER, "image/png", 300);
		await replaceAvatarMedia("av2", USER, "image/png", 100);

		expect(await mediaUsage(USER)).toBe(100);
		const row = await findAvatarMedia(USER);
		expect(row?.id).toBe("av2");
		expect(row?.size).toBe(100);
	});

	test("a repeatedly changed avatar does not accumulate usage", async () => {
		for (let i = 0; i < 20; i++) await replaceAvatarMedia(`av${i}`, USER, "image/png", 300);
		expect(await mediaUsage(USER)).toBe(300);
	});

	test("findAvatarMedia ignores images", async () => {
		await addImage("a", 400);
		expect(await findAvatarMedia(USER)).toBeNull();
	});
});

describe("assertStorageAvailable", () => {
	test("allows an upload that fits", async () => {
		await addImage("a", 500_000);
		await assertStorageAvailable(USER, 400_000);
	});

	test("allows an upload that exactly reaches the limit", async () => {
		await addImage("a", 600_000);
		await assertStorageAvailable(USER, 400_000);
	});

	test("refuses an upload one byte over the limit", async () => {
		await addImage("a", 600_000);
		const err = await rejection(assertStorageAvailable(USER, 400_001));
		expect(err.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);
	});

	test("refuses any upload once the account is already full", async () => {
		await addImage("a", LIMIT);
		const err = await rejection(assertStorageAvailable(USER, 1));
		expect(err.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);
	});

	test("allows an upload again after media is deleted", async () => {
		await addImage("a", LIMIT);
		await sql`DELETE FROM media WHERE username = ${USER} AND id = 'a'`;
		await assertStorageAvailable(USER, 400_000);
	});

	test("counts only the difference when replacing", async () => {
		await addImage("a", 700_000);
		await replaceAvatarMedia("av1", USER, "image/png", 300_000);
		await assertStorageAvailable(USER, 300_000, 300_000);
	});

	test("refuses a replacement that is bigger than the headroom", async () => {
		await addImage("a", 700_000);
		await replaceAvatarMedia("av1", USER, "image/png", 300_000);
		const err = await rejection(assertStorageAvailable(USER, 300_001, 300_000));
		expect(err.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);
	});

	test("allows a smaller replacement on a completely full account", async () => {
		await addImage("a", 700_000);
		await replaceAvatarMedia("av1", USER, "image/png", 300_000);
		await assertStorageAvailable(USER, 100_000, 300_000);
	});
});

describe("unlimited storage", () => {
	test("0 disables the limit", async () => {
		setLimit(0);
		expect(quotaDisabled()).toBe(true);

		await addImage("a", 10_000_000);
		await assertStorageAvailable(USER, 10_000_000);
	});

	test("a negative limit is treated as unlimited, not as zero allowance", async () => {
		setLimit(-1);
		expect(quotaDisabled()).toBe(true);
		await assertStorageAvailable(USER, 5000);
	});

	test("storageQuota reports 0 as the limit when unlimited", async () => {
		setLimit(0);
		await addImage("a", 4000);
		expect(await storageQuota(USER)).toEqual({ used: 4000, limit: 0 });
	});
});

describe("storageQuota", () => {
	test("reports what is used and what is allowed", async () => {
		await addImage("a", 250_000);
		expect(await storageQuota(USER)).toEqual({ used: 250_000, limit: LIMIT });
	});
});

describe("cleanup", () => {
	test("restores the configured limit", () => {
		setLimit(original);
		expect(config.limits.maxAccountStorage).toBe(original);
	});
});
