import type { Creator } from "./api.ts";

const CREATOR_KEY = "bloggy.creator";

/**
 * The session token itself is *not* here: it lives in an httpOnly cookie the
 * browser attaches automatically and JavaScript cannot read, so an XSS bug in
 * the panel cannot exfiltrate it. That is only possible because the panel is
 * served from the same origin as the API.
 *
 * What is kept locally is the creator's profile, purely so the header can
 * render immediately instead of flashing empty while `/auth/me` is in flight.
 * It is a cache, never an authority: whether the visitor is actually signed in
 * is decided by the server on every request.
 */
function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private browsing and "block all cookies" make this throw.
	}
}

function remove(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Nothing was stored.
	}
}

export function isSignedIn(): boolean {
	return read(CREATOR_KEY) !== null;
}

export function getCreator(): Creator | null {
	const raw = read(CREATOR_KEY);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as Creator;
	} catch {
		return null;
	}
}

export function setCreator(creator: Creator): void {
	write(CREATOR_KEY, JSON.stringify(creator));
}

export function clearSession(): void {
	remove(CREATOR_KEY);
}
