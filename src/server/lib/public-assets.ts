import { hash } from "./crypto.ts";
import { LOGO_PNG, LOGO_SVG } from "./logo.ts";
import { BLOG_JS } from "../ssr/scripts.ts";
import { BLOG_CSS } from "../ssr/styles.ts";

export interface PublicAsset {
	path: string;
	legacyPath: string;
	contentType: string;
	body: string | ArrayBuffer;
	etag: string;
}

function asset(name: string, extension: string, contentType: string, body: string | Buffer): PublicAsset {
	const digest = hash(typeof body === "string" ? body : body.toString("base64"));
	return {
		path: `/assets/${name}-${digest.slice(0, 16)}.${extension}`,
		legacyPath: `/assets/${name}.${extension}`,
		contentType,
		body: typeof body === "string" ? body : Uint8Array.from(body).buffer,
		etag: `"${digest}"`,
	};
}

export const BLOG_CSS_ASSET = asset("blog", "css", "text/css; charset=utf-8", BLOG_CSS);
export const BLOG_JS_ASSET = asset("blog", "js", "text/javascript; charset=utf-8", BLOG_JS);
export const LOGO_SVG_ASSET = asset("logo", "svg", "image/svg+xml; charset=utf-8", LOGO_SVG);
export const LOGO_PNG_ASSET = asset("logo", "png", "image/png", LOGO_PNG);

export const PUBLIC_ASSETS = [BLOG_CSS_ASSET, BLOG_JS_ASSET, LOGO_SVG_ASSET, LOGO_PNG_ASSET] as const;
