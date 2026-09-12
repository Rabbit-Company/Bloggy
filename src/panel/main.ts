import "./styles.css";
import { api } from "./api.ts";
import { instanceConfig, setInstanceConfig } from "./constants.ts";
import { clearSession, getCreator, isSignedIn, setCreator } from "./session.ts";
import { startRouter, navigate, panelUrl, type Route } from "./router.ts";
import { el, render, toast } from "./ui.ts";
import {
	renderConfirmEmail,
	renderEmailConfirmationRequest,
	renderForgotPassword,
	renderInvite,
	renderLogin,
	renderRegister,
	renderResetPassword,
} from "./views/auth.ts";
import { renderPosts } from "./views/posts.ts";
import { renderEditor } from "./views/editor.ts";
import { renderImages } from "./views/images.ts";
import { renderAnalytics } from "./views/analytics.ts";
import { renderSettings } from "./views/settings.ts";
import { renderAdmin } from "./views/admin.ts";
import { renderBackups } from "./views/backups.ts";
import { renderTeam } from "./views/team.ts";

const app = document.getElementById("app") as HTMLElement;

const initialPathname = location.pathname;

function consumeTokenFragment(path: string): string {
	if (initialPathname !== panelUrl(path)) return "";

	const fragment = location.hash.slice(1);
	if (fragment.length === 0) return "";
	history.replaceState(history.state, "", `${location.pathname}${location.search}`);

	try {
		return decodeURIComponent(fragment);
	} catch {
		return "";
	}
}

const resetPasswordToken = consumeTokenFragment("/reset-password");
const emailConfirmationToken = consumeTokenFragment("/confirm-email");
const invitationToken = consumeTokenFragment("/invite");

const NAV = [
	{ href: "/posts", label: "Posts" },
	{ href: "/images", label: "Images" },
	{ href: "/analytics", label: "Analytics" },
	{ href: "/team", label: "Team" },
	{ href: "/settings", label: "Settings" },
	{ href: "/admin", label: "Moderation" },
	{ href: "/backups", label: "Backups" },
] as const;

const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="currentColor"/><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 7.5v9"/><path d="M9.5 7.5h3a2.25 2.25 0 0 1 0 4.5h-3"/><path d="M9.5 12h3.5a2.25 2.25 0 0 1 0 4.5h-3.5"/></g></svg>`;

const outlet = el("main");

function shell(): HTMLElement {
	const creator = getCreator();

	const brand = el("a", { class: "brand", href: "/", "aria-label": "Bloggy home" });
	brand.innerHTML = LOGO;
	brand.append(document.createTextNode("Bloggy"));

	const items = NAV.filter((item) => {
		const isOwner = creator?.membership?.isOwner ?? true;
		if (item.href === "/analytics") return isOwner && instanceConfig().analytics !== "none";
		if (item.href === "/team") return isOwner;
		if (item.href === "/admin" || item.href === "/backups") return isOwner && creator?.isAdmin === true;
		return true;
	});

	const nav = el(
		"nav",
		{ class: "nav" },
		...items.map((item) => el("a", { href: panelUrl(item.href), class: location.pathname.startsWith(panelUrl(item.href)) ? "active" : "" }, item.label)),
	);

	const signOut = el("button", { class: "button ghost small" }, "Sign out");
	signOut.addEventListener("click", async () => {
		try {
			await api.logout();
		} catch {
			// Even if the call fails the local session must go.
		}
		clearSession();
		navigate("/");
	});

	// The avatar and username lead to Settings, which is where people try to
	// click. The Settings tab stays: an unlabelled avatar is a guess, a labelled
	// tab is not.
	const settingsActive = location.pathname.startsWith(panelUrl("/settings"));

	const account = el(
		"div",
		{ class: "account" },
		creator !== null &&
			el(
				"a",
				{ class: `who-link${settingsActive ? " active" : ""}`, href: panelUrl("/settings"), title: "Account settings" },
				el("img", { src: `/media/avatars/${creator.username}`, alt: "" }),
				el("span", { class: "who" }, creator.membership?.username ?? creator.username),
			),
		signOut,
	);

	return el("header", { class: "topbar" }, brand, nav, account);
}

function withShell(view: (root: HTMLElement, params: Record<string, string>) => void | Promise<void>) {
	return async (root: HTMLElement, params: Record<string, string>) => {
		render(root, el("div", { class: "app" }, shell(), outlet));
		await view(outlet, params);
	};
}

function guard(view: (root: HTMLElement, params: Record<string, string>) => void | Promise<void>) {
	return async (root: HTMLElement, params: Record<string, string>) => {
		if (!isSignedIn()) {
			navigate("/", true);
			return;
		}
		await withShell(view)(root, params);
	};
}

const routes: Route[] = [
	{
		path: "/",
		auth: false,
		render: (root) => {
			if (isSignedIn()) {
				navigate("/posts", true);
				return;
			}
			renderLogin(root);
		},
	},
	{
		path: "/register",
		auth: false,
		render: (root) => {
			if (isSignedIn()) {
				navigate("/posts", true);
				return;
			}
			renderRegister(root);
		},
	},
	{ path: "/forgot-password", auth: false, render: (root) => renderForgotPassword(root) },
	{ path: "/reset-password", auth: false, render: (root) => renderResetPassword(root, resetPasswordToken) },
	{ path: "/resend-confirmation", auth: false, render: (root) => renderEmailConfirmationRequest(root) },
	{ path: "/confirm-email", auth: false, render: (root) => renderConfirmEmail(root, emailConfirmationToken) },
	{ path: "/invite", auth: false, render: (root) => renderInvite(root, invitationToken) },
	{ path: "/posts", auth: true, render: guard(renderPosts) },
	{ path: "/editor", auth: true, render: guard(renderEditor) },
	{ path: "/editor/:slug", auth: true, render: guard(renderEditor) },
	{ path: "/images", auth: true, render: guard(renderImages) },
	{ path: "/analytics", auth: true, render: guard(renderAnalytics) },
	{ path: "/team", auth: true, render: guard(renderTeam) },
	{ path: "/settings", auth: true, render: guard(renderSettings) },
	{ path: "/admin", auth: true, render: guard(renderAdmin) },
	{ path: "/backups", auth: true, render: guard(renderBackups) },
	{
		path: "/404",
		auth: false,
		render: (root) => {
			render(
				root,
				el(
					"div",
					{ class: "auth" },
					el(
						"div",
						{ class: "auth-card" },
						el("h1", {}, "Not found"),
						el("p", { class: "sub" }, "That page doesn't exist."),
						el("a", { class: "button primary", href: panelUrl(isSignedIn() ? "/posts" : "/") }, "Go back"),
					),
				),
			);
		},
	},
];

try {
	setInstanceConfig(await api.config());
} catch {
	// The built-in defaults mirror the server's own, so the panel still works.
}

startRouter({ outlet: app, routes });

if (isSignedIn()) {
	void api
		.me()
		.then((me) => setCreator(me.creator))
		.catch(() => {
			if (!isSignedIn()) {
				toast("Your session expired. Please sign in again.", "info");
				navigate("/", true);
			}
		});
}
