import { isIP } from "node:net";
import { config } from "../config.ts";

export function normalizeCustomHostname(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const raw = value.trim().toLowerCase().replace(/\.$/, "");
	if (raw.length === 0 || raw.length > 253 || raw.includes("://") || /[\s/@:#?\\]/.test(raw)) return null;

	let hostname: string;
	try {
		const parsed = new URL(`http://${raw}`);
		if (parsed.hostname.length === 0 || parsed.port.length > 0 || parsed.pathname !== "/") return null;
		hostname = parsed.hostname.toLowerCase();
	} catch {
		return null;
	}

	if (isIP(hostname) !== 0 || hostname === "localhost" || !hostname.includes(".")) return null;
	const labels = hostname.split(".");
	if (labels.some((label) => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
		return null;
	}

	return hostname;
}

export function mainHostname(): string {
	return new URL(config.server.domain).hostname.toLowerCase();
}

export function isReservedCustomHostname(hostname: string): boolean {
	return hostname === mainHostname() || hostname === config.customDomains.cnameTarget;
}
