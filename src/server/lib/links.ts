import { config } from "../config.ts";

export type PanelTokenRoute = "confirm-email" | "invite" | "reset-password";

/**
 * URL fragments stay in the browser and are not included in HTTP requests,
 * which keeps one-use credentials out of access logs and referrer headers.
 */
export function panelTokenUrl(route: PanelTokenRoute, token: string): string {
	return `${config.server.domain}/panel/${route}#${encodeURIComponent(token)}`;
}
