import { describe, expect, test } from "bun:test";
import { Web } from "@rabbit-company/web";
import { ADMIN_API_IP_RATE_LIMIT, ADMIN_RATE_LIMITS, adminApiIpRateLimit, adminRateLimit } from "../src/server/middleware/admin-rate-limit.ts";
import { normalizeErrorEnvelope } from "../src/server/middleware/envelope.ts";
import { ErrorCode } from "../src/shared/errors.ts";
import type { CreatorRow } from "../src/server/db/creators.ts";
import type { AppState } from "../src/server/types.ts";

function testApp() {
	const app = new Web<AppState>();
	app.use(normalizeErrorEnvelope());
	app.get(
		"/admin-test",
		async (ctx, next) => {
			ctx.set("creator", { username: ctx.req.headers.get("X-Test-Admin") ?? "admin" } as CreatorRow);
			return await next();
		},
		adminRateLimit("test.critical", "critical"),
		(ctx) => ctx.json({ ok: true }),
	);
	return app;
}

function request(app: Web<AppState>, username: string) {
	return app.handle(new Request("http://localhost/admin-test", { headers: { "X-Test-Admin": username } }));
}

describe("admin API rate limits", () => {
	test("uses progressively tighter profiles for higher impact operations", () => {
		expect(ADMIN_API_IP_RATE_LIMIT).toEqual({ windowMs: 60_000, max: 180 });
		expect(ADMIN_RATE_LIMITS.read).toEqual({ windowMs: 60_000, max: 120 });
		expect(ADMIN_RATE_LIMITS.write).toEqual({ windowMs: 300_000, max: 30 });
		expect(ADMIN_RATE_LIMITS.sensitive).toEqual({ windowMs: 3_600_000, max: 10 });
		expect(ADMIN_RATE_LIMITS.expensive).toEqual({ windowMs: 3_600_000, max: 3 });
		expect(ADMIN_RATE_LIMITS.critical).toEqual({ windowMs: 3_600_000, max: 2 });
	});

	test("blocks requests over the limit and returns retry metadata", async () => {
		const app = testApp();

		const first = await request(app, "alice");
		const second = await request(app, "alice");
		const blocked = await request(app, "alice");

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(second.headers.get("RateLimit-Limit")).toBe("2");
		expect(second.headers.get("RateLimit-Remaining")).toBe("0");
		expect(blocked.status).toBe(429);
		expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(await blocked.json()).toMatchObject({
			error: ErrorCode.RATE_LIMITED,
			info: "Too many requests. Please slow down.",
			limit: 2,
			window: 3_600_000,
		});
	});

	test("shares the pre-authentication IP allowance across admin paths", async () => {
		const app = new Web<AppState>();
		const limiter = adminApiIpRateLimit();
		app.use(normalizeErrorEnvelope());
		app.get("/admin-one", limiter, (ctx) => ctx.json({ ok: true }));
		app.get("/admin-two", limiter, (ctx) => ctx.json({ ok: true }));

		let response = new Response();
		for (let index = 0; index < ADMIN_API_IP_RATE_LIMIT.max; index++) {
			const path = index % 2 === 0 ? "/admin-one" : "/admin-two";
			response = await app.handle(new Request(`http://localhost${path}`));
		}

		expect(response.status).toBe(200);
		const blocked = await app.handle(new Request("http://localhost/admin-two"));
		expect(blocked.status).toBe(429);
		expect(await blocked.json()).toMatchObject({ error: ErrorCode.RATE_LIMITED, limit: 180 });
	});

	test("keeps allowances separate for each administrator", async () => {
		const app = testApp();
		await request(app, "alice");
		await request(app, "alice");

		expect((await request(app, "alice")).status).toBe(429);
		expect((await request(app, "bob")).status).toBe(200);
	});
});
