import { beforeAll, describe, expect, test } from "bun:test";
import { createSession, resolveSession } from "../src/server/auth/sessions.ts";
import { findCreator, insertCreator } from "../src/server/db/creators.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { consumePasswordResetToken, createPasswordResetToken, passwordResetTokenExists } from "../src/server/db/password-resets.ts";
import { findTeamMember, insertTeamMember } from "../src/server/db/team.ts";
import { createApp } from "../src/server/index.ts";
import { panelAssetCacheControl } from "../src/server/routes/panel.ts";

const OWNER = "reset-owner";
const MEMBER = "reset-member";

beforeAll(async () => {
	await migrate();
	await sql`DELETE FROM password_reset_tokens WHERE username IN (${OWNER}, ${MEMBER})`;
	await sql`DELETE FROM sessions WHERE username IN (${OWNER}, ${MEMBER})`;
	await sql`DELETE FROM team_members WHERE username = ${MEMBER}`;
	await sql`DELETE FROM creators WHERE username = ${OWNER}`;
	await insertCreator({
		username: OWNER,
		password: "old-owner-hash",
		email: "owner-reset@example.com",
		title: "Reset Blog",
		description: "A sufficiently complete description for the password reset tests.",
		author: "Reset Owner",
		category: "Technology",
		language: "en",
		theme: "light",
	});
	await insertTeamMember({ username: MEMBER, blogUsername: OWNER, password: "old-member-hash", email: "member-reset@example.com", role: "writer" });
});

describe("SMTP feature gate", () => {
	test("keeps password reset hidden when SMTP is not configured", async () => {
		const response = await createApp().handle(new Request("http://localhost:3000/api/v1/config"));
		const envelope = (await response.json()) as { data: { passwordResetEnabled: boolean } };
		expect(envelope.data.passwordResetEnabled).toBe(false);
	});

	test("refuses the reset request API while disabled", async () => {
		const response = await createApp().handle(
			new Request("http://localhost:3000/api/v1/auth/password-reset/request", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: OWNER }),
			}),
		);
		expect(response.status).toBe(409);
	});
});

describe("sensitive panel links", () => {
	test("caches fingerprinted panel bundles and assets immutably", () => {
		expect(panelAssetCacheControl("main-5gg30t2j.css")).toBe("public, max-age=31536000, immutable");
		expect(panelAssetCacheControl("world-61m5k3x8.svg")).toBe("public, max-age=31536000, immutable");
		expect(panelAssetCacheControl("favicon.svg")).toBe("public, max-age=0, must-revalidate");
	});

	test("use a no-referrer policy without weakening ordinary panel pages", async () => {
		const app = createApp();
		for (const path of ["/panel/reset-password", "/panel/confirm-email", "/panel/invite", "/panel/reset-password/legacy-token"]) {
			const response = await app.handle(new Request(`http://localhost:3000${path}`));
			expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		}

		const ordinary = await app.handle(new Request("http://localhost:3000/panel"));
		expect(ordinary.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
	});

	test("does not expose reset tokens through legacy API paths", async () => {
		const response = await createApp().handle(new Request(`http://localhost:3000/api/v1/auth/password-reset/${"a".repeat(64)}`));
		expect(response.status).toBe(404);
	});
});

describe("one-use reset tokens", () => {
	test("resets an owner password, consumes the token and revokes sessions", async () => {
		const session = await createSession(OWNER);
		const token = await createPasswordResetToken(OWNER, 3_600);
		expect(token).not.toBeNull();
		expect(await passwordResetTokenExists(token!)).toBe(true);
		expect(await consumePasswordResetToken(token!, "new-owner-hash")).toBe(true);
		expect((await findCreator(OWNER))?.password).toBe("new-owner-hash");
		expect(await resolveSession(session.token)).toBeNull();
		expect(await passwordResetTokenExists(token!)).toBe(false);
		expect(await consumePasswordResetToken(token!, "another-hash")).toBe(false);
	});

	test("supports collaborator credentials too", async () => {
		const session = await createSession(MEMBER);
		const token = await createPasswordResetToken(MEMBER, 3_600);
		expect(await consumePasswordResetToken(token!, "new-member-hash")).toBe(true);
		expect((await findTeamMember(MEMBER))?.password).toBe("new-member-hash");
		expect(await resolveSession(session.token)).toBeNull();
	});

	test("does not issue another email token during the cooldown", async () => {
		const first = await createPasswordResetToken(OWNER, 3_600);
		expect(first).not.toBeNull();
		expect(await createPasswordResetToken(OWNER, 3_600)).toBeNull();
	});
});
