import { config } from "../config.ts";

export const SESSION_COOKIE = "bloggy_session";

export function readCookie(req: Request, name: string): string | null {
	const header = req.headers.get("Cookie");
	if (header === null) return null;

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;

		const value = part.slice(separator + 1).trim();
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	return null;
}

/**
 * `HttpOnly` keeps the token out of reach of JavaScript, so an XSS bug in the
 * panel cannot read it. `SameSite=Lax` means the browser will not attach it to
 * a cross-site POST, which blocks the ordinary CSRF shape. The Origin check in
 * the CSRF middleware is the second layer. `Secure` is set whenever the public
 * origin is HTTPS. It is omitted on plain-HTTP localhost, where it would stop the
 * cookie being stored at all.
 */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
	const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];

	if (config.server.domain.startsWith("https://")) parts.push("Secure");
	return parts.join("; ");
}

export function clearSessionCookie(): string {
	const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
	if (config.server.domain.startsWith("https://")) parts.push("Secure");
	return parts.join("; ");
}
