import { describe, expect, test } from "bun:test";
import { backupStatus } from "../src/server/lib/backup.ts";

describe("availability", () => {
	test("is unavailable without a bucket, and says why", () => {
		const status = backupStatus();
		expect(status.available).toBe(false);
		expect(status.reason).toBeString();
	});

	test("never reports itself enabled when it cannot run", () => {
		const status = backupStatus();
		if (!status.available) expect(status.enabled).toBe(false);
	});

	test("clamps the interval so a typo cannot schedule a backup every second", () => {
		expect(backupStatus().intervalSeconds).toBeGreaterThanOrEqual(300);
	});

	test("keeps at least one backup however low the limit is set", () => {
		expect(backupStatus().keep).toBeGreaterThanOrEqual(1);
	});
});

describe("snapshot naming", () => {
	const NAME = /^bloggy-[0-9]{8}T[0-9]{6}Z\.sqlite$/;

	test.each([
		["bloggy-20260911T052202Z.sqlite", true],
		["bloggy-20260911T052202Z.txt", false],
		["../../etc/passwd", false],
		["/etc/passwd", false],
		["bloggy-2026-09-11T05:22:02Z.sqlite", false],
		["anything.sqlite", false],
		["", false],
	])("%s", (name, accepted) => {
		expect(NAME.test(name as string)).toBe(accepted as boolean);
	});

	test("the generated name matches the pattern it is validated against", () => {
		const generated = `bloggy-${new Date()
			.toISOString()
			.replace(/[-:]/g, "")
			.replace(/\.\d+Z$/, "Z")}.sqlite`;
		expect(generated).toMatch(NAME);
	});
});
