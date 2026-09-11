import { Web } from "@rabbit-company/web";
import { join, normalize, resolve } from "node:path";
import { PANEL_BASE } from "../../shared/constants.ts";
import { logger } from "../lib/logger.ts";
import type { AppState } from "../types.ts";

const PANEL_DIR = resolve(process.env.PANEL_DIR ?? "./public/panel");

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

function contentType(path: string): string {
	const dot = path.lastIndexOf(".");
	return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)]) ?? "application/octet-stream";
}

export function panelRoutes(app: Web<AppState>): void {
	const indexPath = join(PANEL_DIR, "index.html");

	async function serveIndex(): Promise<Response> {
		const file = Bun.file(indexPath);
		if (!(await file.exists())) {
			return new Response("<h1>Panel not built</h1><p>Run <code>bun run build:panel</code> to build the creator panel.</p>", {
				status: 503,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		return new Response(file, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
				"X-Frame-Options": "DENY",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "strict-origin-when-cross-origin",
			},
		});
	}

	app.get(PANEL_BASE, () => serveIndex());

	app.get(`${PANEL_BASE}/*`, async (ctx) => {
		const pathname = new URL(ctx.req.url).pathname;
		const relative = pathname.slice(PANEL_BASE.length).replace(/^\/+/, "");

		if (relative.length === 0) return serveIndex();

		if (relative.includes("..") || relative.includes("\0") || normalize(relative) !== relative) {
			return serveIndex();
		}

		const full = resolve(join(PANEL_DIR, relative));
		if (!full.startsWith(`${PANEL_DIR}/`)) return serveIndex();

		const file = Bun.file(full);
		if (!(await file.exists())) return serveIndex();

		return new Response(file, {
			headers: {
				"Content-Type": contentType(full),
				"Cache-Control": "public, max-age=0, must-revalidate",
				"X-Content-Type-Options": "nosniff",
			},
		});
	});

	logger.info(`Creator panel served from ${PANEL_DIR} at ${PANEL_BASE}`);
}
