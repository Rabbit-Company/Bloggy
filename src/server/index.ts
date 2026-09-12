import { Web } from "@rabbit-company/web";
import { cors } from "@rabbit-company/web-middleware/cors";
import { ipExtract } from "@rabbit-company/web-middleware/ip-extract";
import { logger as loggerMiddleware } from "@rabbit-company/web-middleware/logger";
import { rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { config } from "./config.ts";
import { logger } from "./lib/logger.ts";
import { ApiError, ErrorCode, errorMessage } from "./lib/errors.ts";
import { connect, disconnect } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { pruneExpiredSessions } from "./db/sessions.ts";
import { metrics } from "./middleware/metrics.ts";
import { normalizeErrorEnvelope } from "./middleware/envelope.ts";
import { authRoutes } from "./routes/auth.ts";
import { creatorRoutes } from "./routes/creators.ts";
import { postRoutes } from "./routes/posts.ts";
import { mediaRoutes } from "./routes/media.ts";
import { publicRoutes } from "./routes/public.ts";
import { adminRoutes, refreshGauges } from "./routes/admin.ts";
import { moderationRoutes } from "./routes/moderation.ts";
import { panelRoutes } from "./routes/panel.ts";
import { analyticsRoutes } from "./routes/analytics.ts";
import { teamRoutes } from "./routes/team.ts";
import { pruneExpiredTeamInvites } from "./db/team.ts";
import { pruneExpiredPasswordResetTokens } from "./db/password-resets.ts";
import { pruneExpiredEmailConfirmationTokens } from "./db/email-confirmations.ts";
import { csrfGuard } from "./middleware/csrf.ts";
import { startBackupSchedule } from "./lib/backup.ts";
import { isAdminCommand, readUsername, runAdminCommand } from "./lib/admin-cli.ts";
import { renderErrorPage } from "./ssr/pages.ts";
import type { AppMiddleware, AppState } from "./types.ts";

function wantsJson(req: Request): boolean {
	const url = new URL(req.url);
	if (url.pathname.startsWith("/api/")) return true;
	return (req.headers.get("Accept") ?? "").includes("application/json");
}

/**
 * Headers every response carries.
 *
 * `nosniff` matters most on the blog, which renders creator-authored content:
 * without it a browser may disregard the declared type and execute something it
 * decided looked like script. The referrer policy keeps post URLs, which can be
 * unpublished previews, out of other sites' logs.
 *
 * Framing is not restricted here. The panel already denies it at its own route,
 * and a public blog has no authenticated action worth clickjacking.
 */
function securityHeaders(): AppMiddleware {
	return async (ctx, next) => {
		const response = await next();
		// A middleware may hand back nothing when it has already written.
		if (response instanceof Response) {
			response.headers.set("X-Content-Type-Options", "nosniff");
			if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
		}
		return response;
	};
}

export function createApp(): Web<AppState> {
	const app = new Web<AppState>();

	app.use(ipExtract(config.server.trustProxy));
	app.use(metrics());
	app.use(securityHeaders());
	app.use(normalizeErrorEnvelope());

	app.use(
		loggerMiddleware<AppState>({
			logger,
			preset: "standard",
			includeRemoteAddress: true,
			excludePaths: ["/health", "/metrics", /^\/assets\//],
		}),
	);

	// The panel is served from this origin, so it needs no CORS. This is only
	// for external API clients, and stays off unless an operator opts in with
	// API_ORIGINS. Credentials are deliberately not allowed: a cross-origin
	// caller authenticates with a bearer token, never the session cookie.
	//
	// The pattern is "/api/*", not "/api": path-scoped middleware in this
	// framework matches the path exactly, so "/api" would apply to nothing but
	// a request for "/api" itself.
	if (config.server.apiOrigins.length > 0) {
		app.use(
			"/api/*",
			cors<AppState>({
				origin: config.server.apiOrigins.includes("*") ? "*" : [...config.server.apiOrigins],
				allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				allowHeaders: ["Authorization", "Content-Type"],
				exposeHeaders: ["X-Cache", "RateLimit-Remaining", "RateLimit-Reset"],
				credentials: false,
				maxAge: 86400,
			}),
		);
	}

	app.use("/api/*", csrfGuard());

	app.use(
		"/api/*",
		rateLimit<AppState>({
			windowMs: 60_000,
			max: 300,
			message: errorMessage(ErrorCode.RATE_LIMITED),
			statusCode: 429,
		}),
	);

	panelRoutes(app);
	publicRoutes(app);
	authRoutes(app);
	creatorRoutes(app);
	postRoutes(app);
	mediaRoutes(app);
	analyticsRoutes(app);
	teamRoutes(app);
	adminRoutes(app);
	moderationRoutes(app);

	app.onNotFound((ctx) => {
		if (wantsJson(ctx.req)) {
			return ctx.json({ error: ErrorCode.NOT_FOUND, info: "Invalid API endpoint." }, 404);
		}
		return ctx.html(renderErrorPage(404, "This page doesn't exist."), 404);
	});

	app.onError((err, ctx) => {
		if (err instanceof ApiError) {
			if (wantsJson(ctx.req)) {
				return ctx.json({ error: err.code, info: err.message, ...err.details }, err.status);
			}
			return ctx.html(renderErrorPage(err.status, err.message), err.status);
		}

		logger.error(`Unhandled error: ${err.message}`, { stack: err.stack, url: ctx.req.url });

		if (wantsJson(ctx.req)) {
			return ctx.json({ error: ErrorCode.INTERNAL_ERROR, info: errorMessage(ErrorCode.INTERNAL_ERROR) }, 500);
		}
		return ctx.html(renderErrorPage(500, "Something went wrong."), 500);
	});

	return app;
}

function startMaintenance(): ReturnType<typeof setInterval> {
	const run = async () => {
		try {
			await pruneExpiredSessions();
			await pruneExpiredTeamInvites();
			await pruneExpiredPasswordResetTokens();
			await pruneExpiredEmailConfirmationTokens();
			if (config.metrics.enabled) await refreshGauges();
		} catch (err) {
			logger.warn("Maintenance pass failed", { error: String(err) });
		}
	};

	void run();
	const timer = setInterval(run, 3_600_000);
	timer.unref?.();
	return timer;
}

if (import.meta.main) {
	const [command, ...rest] = process.argv.slice(2);
	if (isAdminCommand(command)) {
		process.exit(await runAdminCommand(command, readUsername(rest)));
	}

	await connect();
	await migrate();

	const app = createApp();
	const maintenance = startMaintenance();
	startBackupSchedule();

	const server = await app.listen({
		port: config.server.port,
		hostname: config.server.hostname,
		onListen: ({ port, hostname, runtime }) => {
			logger.info(`Bloggy listening on http://${hostname}:${port} (${runtime})`);
			logger.info(`Public site: ${config.server.domain}`);
		},
	});

	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down`);
		clearInterval(maintenance);
		await server.stop();
		await disconnect();
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
