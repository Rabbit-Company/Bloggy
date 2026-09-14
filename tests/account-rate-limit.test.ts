import { describe, expect, test } from "bun:test";
import { Web } from "@rabbit-company/web";
import { ACCOUNT_RATE_LIMITS, ANONYMOUS_ACTION_RATE_LIMITS, accountRateLimit, anonymousActionRateLimit } from "../src/server/middleware/account-rate-limit.ts";
import { normalizeErrorEnvelope } from "../src/server/middleware/envelope.ts";
import { ErrorCode } from "../src/shared/errors.ts";
import type { AuthActor } from "../src/server/types.ts";
import type { AppState } from "../src/server/types.ts";

function testApp() {
	const app = new Web<AppState>();
	app.use(normalizeErrorEnvelope());
	app.get(
		"/account-test",
		async (ctx, next) => {
			const username = ctx.req.headers.get("X-Test-Actor") ?? "member";
			ctx.set("actor", { username } as AuthActor);
			return await next();
		},
		accountRateLimit("test.critical", "critical"),
		(ctx) => ctx.json({ ok: true }),
	);
	return app;
}

function request(app: Web<AppState>, username: string) {
	return app.handle(new Request("http://localhost/account-test", { headers: { "X-Test-Actor": username } }));
}

describe("account API rate limits", () => {
	test("defines limits based on endpoint cost and impact", () => {
		expect(ACCOUNT_RATE_LIMITS.read).toEqual({ windowMs: 60_000, max: 180 });
		expect(ACCOUNT_RATE_LIMITS.write).toEqual({ windowMs: 300_000, max: 60 });
		expect(ACCOUNT_RATE_LIMITS.preview).toEqual({ windowMs: 60_000, max: 120 });
		expect(ACCOUNT_RATE_LIMITS.upload).toEqual({ windowMs: 600_000, max: 60 });
		expect(ACCOUNT_RATE_LIMITS.analytics).toEqual({ windowMs: 300_000, max: 60 });
		expect(ACCOUNT_RATE_LIMITS.security).toEqual({ windowMs: 3_600_000, max: 10 });
		expect(ACCOUNT_RATE_LIMITS.critical).toEqual({ windowMs: 3_600_000, max: 3 });
		expect(ANONYMOUS_ACTION_RATE_LIMITS.register).toEqual({ windowMs: 3_600_000, max: 5 });
		expect(ANONYMOUS_ACTION_RATE_LIMITS.credential).toEqual({ windowMs: 900_000, max: 10 });
		expect(ANONYMOUS_ACTION_RATE_LIMITS.email).toEqual({ windowMs: 900_000, max: 5 });
		expect(ANONYMOUS_ACTION_RATE_LIMITS.token).toEqual({ windowMs: 900_000, max: 30 });
		expect(ANONYMOUS_ACTION_RATE_LIMITS.invitation).toEqual({ windowMs: 900_000, max: 10 });
	});

	test("blocks an identity after its endpoint allowance is exhausted", async () => {
		const app = testApp();
		await request(app, "writer-one");
		await request(app, "writer-one");
		await request(app, "writer-one");

		const blocked = await request(app, "writer-one");
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("RateLimit-Limit")).toBe("3");
		expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(await blocked.json()).toMatchObject({ error: ErrorCode.RATE_LIMITED, limit: 3, window: 3_600_000 });
	});

	test("gives each owner and team member an independent allowance", async () => {
		const app = testApp();
		await request(app, "writer-one");
		await request(app, "writer-one");
		await request(app, "writer-one");

		expect((await request(app, "writer-one")).status).toBe(429);
		expect((await request(app, "editor-two")).status).toBe(200);
	});

	test("limits actions that happen before authentication by IP", async () => {
		const app = new Web<AppState>();
		app.use(normalizeErrorEnvelope());
		app.post("/register-test", anonymousActionRateLimit("test.register", "register"), (ctx) => ctx.json({ ok: true }));

		for (let index = 0; index < ANONYMOUS_ACTION_RATE_LIMITS.register.max; index++) {
			expect((await app.handle(new Request("http://localhost/register-test", { method: "POST" }))).status).toBe(200);
		}

		const blocked = await app.handle(new Request("http://localhost/register-test", { method: "POST" }));
		expect(blocked.status).toBe(429);
		expect(await blocked.json()).toMatchObject({ error: ErrorCode.RATE_LIMITED, limit: 5, window: 3_600_000 });
	});
});
