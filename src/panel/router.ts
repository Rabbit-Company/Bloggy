import { PANEL_BASE } from "../shared/constants.ts";

function stripBase(pathname: string): string {
	if (pathname === PANEL_BASE) return "/";
	if (pathname.startsWith(`${PANEL_BASE}/`)) return pathname.slice(PANEL_BASE.length);
	return pathname;
}

export function panelUrl(path: string): string {
	return path === "/" ? PANEL_BASE : `${PANEL_BASE}${path}`;
}

export interface Route {
	path: string;
	auth: boolean;
	render: (root: HTMLElement, params: Record<string, string>) => void | Promise<void>;
}

let routes: Route[] = [];
let outlet: HTMLElement | null = null;
let onNavigate: (() => void) | null = null;

function match(route: Route, pathname: string): Record<string, string> | null {
	const expected = route.path.split("/").filter((s) => s.length > 0);
	const actual = pathname.split("/").filter((s) => s.length > 0);
	if (expected.length !== actual.length) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < expected.length; i++) {
		const segment = expected[i] as string;
		const value = actual[i] as string;
		if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(value);
		else if (segment !== value) return null;
	}
	return params;
}

export function resolve(pathname: string): { route: Route; params: Record<string, string> } | null {
	for (const route of routes) {
		const params = match(route, pathname);
		if (params !== null) return { route, params };
	}
	return null;
}

export function navigate(path: string, replace = false): void {
	const url = path.startsWith(PANEL_BASE) ? path : panelUrl(path);
	if (replace) history.replaceState({}, "", url);
	else history.pushState({}, "", url);
	void handle();
}

async function handle(): Promise<void> {
	if (outlet === null) return;
	onNavigate?.();

	const found = resolve(stripBase(location.pathname));
	if (found === null) {
		const fallback = resolve("/404");
		if (fallback !== null) await fallback.route.render(outlet, {});
		return;
	}

	await found.route.render(outlet, found.params);
	window.scrollTo(0, 0);
}

export function startRouter(config: { outlet: HTMLElement; routes: Route[]; onNavigate?: () => void }): void {
	outlet = config.outlet;
	routes = config.routes;
	onNavigate = config.onNavigate ?? null;

	window.addEventListener("popstate", () => void handle());

	document.addEventListener("click", (event) => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		const anchor = (event.target as HTMLElement | null)?.closest?.("a");
		if (anchor === null || anchor === undefined) return;
		if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

		const href = anchor.getAttribute("href");
		if (href === null || !href.startsWith("/")) return;
		if (!href.startsWith(`${PANEL_BASE}/`) && href !== PANEL_BASE) return;

		event.preventDefault();
		navigate(href);
	});

	void handle();
}
