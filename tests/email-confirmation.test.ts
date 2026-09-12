import { beforeAll, describe, expect, test } from "bun:test";
import { consumeEmailConfirmationToken, createEmailConfirmationToken, emailConfirmationTokenExists } from "../src/server/db/email-confirmations.ts";
import { findCreator, insertCreator, isEmailVerified, listCreators } from "../src/server/db/creators.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { createApp } from "../src/server/index.ts";

const PENDING = "confirm-pending";
const FALLBACK = "confirm-fallback";

async function createPending(username: string): Promise<void> {
	await insertCreator({
		username,
		password: await Bun.password.hash("a-secure-test-password", { algorithm: "argon2id" }),
		email: `${username}@example.com`,
		emailVerified: false,
		title: "Confirmation Blog",
		description: "A sufficiently complete description for email confirmation tests.",
		author: "Confirmation Owner",
		category: "Technology",
		language: "en",
		theme: "light",
	});
}

beforeAll(async () => {
	await migrate();
	await sql`DELETE FROM email_confirmation_tokens WHERE username IN (${PENDING}, ${FALLBACK})`;
	await sql`DELETE FROM creators WHERE username IN (${PENDING}, ${FALLBACK})`;
	await createPending(PENDING);
});

describe("SMTP feature gate", () => {
	test("reports email confirmation as disabled without SMTP", async () => {
		const response = await createApp().handle(new Request("http://localhost:3000/api/v1/config"));
		const envelope = (await response.json()) as { data: { emailConfirmationEnabled: boolean } };
		expect(envelope.data.emailConfirmationEnabled).toBe(false);
	});

	test("refuses confirmation email requests while disabled", async () => {
		const response = await createApp().handle(
			new Request("http://localhost:3000/api/v1/auth/email-confirmation/request", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: PENDING }),
			}),
		);
		expect(response.status).toBe(409);
	});
});

describe("one-use email confirmation tokens", () => {
	test("keeps a pending account private until its address is confirmed", async () => {
		expect(isEmailVerified((await findCreator(PENDING))!)).toBe(false);
		expect((await listCreators()).some((creator) => creator.username === PENDING)).toBe(false);
		const hidden = await createApp().handle(new Request(`http://localhost:3000/api/v1/creators/${PENDING}`));
		expect(hidden.status).toBe(404);

		const token = await createEmailConfirmationToken(PENDING, `${PENDING}@example.com`, 3_600);
		expect(token).not.toBeNull();
		expect(await emailConfirmationTokenExists(token!)).toBe(true);

		const stored = (await sql`SELECT token_hash FROM email_confirmation_tokens WHERE username = ${PENDING}`) as { token_hash: string }[];
		expect(stored[0]?.token_hash).not.toBe(token);

		expect(await consumeEmailConfirmationToken(token!)).toBe(PENDING);
		expect(isEmailVerified((await findCreator(PENDING))!)).toBe(true);
		expect((await listCreators()).some((creator) => creator.username === PENDING)).toBe(true);
		expect(await emailConfirmationTokenExists(token!)).toBe(false);
		expect(await consumeEmailConfirmationToken(token!)).toBeNull();
	});

	test("does not issue another email during the resend cooldown", async () => {
		await createPending(FALLBACK);
		const first = await createEmailConfirmationToken(FALLBACK, `${FALLBACK}@example.com`, 3_600);
		expect(first).not.toBeNull();
		expect(await createEmailConfirmationToken(FALLBACK, `${FALLBACK}@example.com`, 3_600)).toBeNull();
	});

	test("does not strand pending accounts if SMTP is later disabled", async () => {
		const response = await createApp().handle(
			new Request("http://localhost:3000/api/v1/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: FALLBACK, password: "a-secure-test-password" }),
			}),
		);
		expect(response.status).toBe(200);
		expect(isEmailVerified((await findCreator(FALLBACK))!)).toBe(true);
	});
});
