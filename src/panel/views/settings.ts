import { QRCode, ErrorCorrectionLevel } from "@rabbit-company/qrcode";
import PasswordEntropy from "@rabbit-company/password-entropy";
import { api, type Creator, type CreatorCustomization, type Session } from "../api.ts";
import { CATEGORIES, DEFAULT_THEME_COLORS, LANGUAGES, SOCIAL_PLATFORMS, THEMES, instanceConfig } from "../constants.ts";
import { HOME_STARTER_TEMPLATE, HOME_TEMPLATE_COMPONENTS, POST_STARTER_TEMPLATE, POST_TEMPLATE_COMPONENTS } from "../../shared/customization.ts";
import type { ThemeColors } from "../../shared/constants.ts";
import { clearSession, setCreator } from "../session.ts";
import { compressImage, confirm, el, field, formatDateTime, modal, render, setHtml, toast } from "../ui.ts";
import { navigate } from "../router.ts";

function select(name: string, options: readonly (string | { value: string; label: string })[], selected?: string): HTMLSelectElement {
	const node = el("select", { name, id: name });
	for (const option of options) {
		const value = typeof option === "string" ? option : option.value;
		const label = typeof option === "string" ? option : option.label;
		node.append(el("option", { value, selected: value === selected }, label));
	}
	return node;
}

function labelled(label: string, control: HTMLElement, help?: string): HTMLElement {
	return el("label", { class: "field", for: control.id }, el("span", {}, label), control, help !== undefined && el("span", { class: "help" }, help));
}

const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
	{ key: "background", label: "Background" },
	{ key: "surface", label: "Cards" },
	{ key: "text", label: "Text" },
	{ key: "muted", label: "Muted text" },
	{ key: "border", label: "Borders" },
	{ key: "accent", label: "Accent" },
];

function backupCodes(codes: string[]): HTMLElement {
	const blob = new Blob([`Bloggy backup codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });

	return el(
		"div",
		{},
		el("p", {}, "Store these somewhere safe. Each one signs you in once if you lose your authenticator."),
		el("div", { class: "codes" }, ...codes.map((code) => el("span", {}, code))),
		el("a", { class: "button ghost small", href: URL.createObjectURL(blob), download: "bloggy-backup-codes.txt" }, "Download"),
	);
}

export async function renderSettings(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading settings…"));

	let creator: Creator;
	let backupCodesRemaining = 0;
	let sessions: Session[] = [];
	let customization: CreatorCustomization = { customCss: "", homeTemplate: "", postTemplate: "", updatedAt: null };

	try {
		const me = await api.me();
		creator = me.creator;
		backupCodesRemaining = me.backupCodesRemaining;
		setCreator(creator);
		const [sessionResult, customizationResult] = await Promise.all([
			api.sessions(),
			creator.membership?.isOwner === false ? Promise.resolve(null) : api.customization(),
		]);
		sessions = sessionResult.sessions;
		if (customizationResult) customization = customizationResult;
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load your settings."));
		return;
	}

	const reload = () => void renderSettings(root);
	const isOwner = creator.membership?.isOwner ?? true;
	const accountUsername = creator.membership?.username ?? creator.username;

	const title = el("input", { id: "title", maxlength: "30", value: creator.title });
	const description = el("textarea", { id: "description", maxlength: "160", rows: "3" });
	description.value = creator.description;
	const author = el("input", { id: "author", maxlength: "30", value: creator.author });
	const category = select("category", CATEGORIES, creator.category);
	const language = select("language", LANGUAGES, creator.language);
	const theme = select("theme", THEMES, creator.theme);
	const savedColors = creator.themeColors ?? DEFAULT_THEME_COLORS;
	const colorInputs = Object.fromEntries(
		COLOR_FIELDS.map(({ key }) => [key, el("input", { id: `theme-${key}`, type: "color", value: savedColors[key] })]),
	) as Record<keyof ThemeColors, HTMLInputElement>;
	const colorPicker = el(
		"div",
		{ class: "theme-colors", hidden: theme.value !== "custom" },
		el("div", { class: "theme-colors-head" }, el("strong", {}, "Custom palette"), el("span", {}, "Changes apply to your home page and every post.")),
		el("div", { class: "color-grid" }, ...COLOR_FIELDS.map(({ key, label }) => labelled(label, colorInputs[key]))),
	);
	theme.addEventListener("change", () => {
		colorPicker.hidden = theme.value !== "custom";
	});
	const saveSettings = el("button", { class: "button primary" }, "Save settings");

	saveSettings.addEventListener("click", async () => {
		saveSettings.disabled = true;
		try {
			await api.updateSettings({
				title: title.value.trim(),
				description: description.value.trim(),
				author: author.value.trim(),
				category: category.value,
				language: language.value,
				theme: theme.value,
				themeColors: Object.fromEntries(COLOR_FIELDS.map(({ key }) => [key, colorInputs[key].value])) as unknown as ThemeColors,
			});
			toast("Settings saved.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not save settings.", "error");
		} finally {
			saveSettings.disabled = false;
		}
	});

	const avatarImage = el("img", {
		src: `/media/avatars/${creator.username}?t=${Date.now()}`,
		alt: "",
		style: "width:5rem;height:5rem;border-radius:50%;background:var(--surface-2)",
	});
	const avatarInput = el("input", { type: "file", accept: "image/*", style: "display:none" });

	avatarInput.addEventListener("change", async () => {
		const file = avatarInput.files?.[0];
		if (file === undefined) return;

		try {
			const blob = await compressImage(file, { maxWidth: 512, maxBytes: instanceConfig().maxAvatarSize });
			await api.uploadAvatar(blob);
			avatarImage.src = `/media/avatars/${creator.username}?t=${Date.now()}`;
			toast("Avatar updated.", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Upload failed.", "error");
		} finally {
			avatarInput.value = "";
		}
	});

	const socialInputs = SOCIAL_PLATFORMS.map((platform) => {
		const input = el("input", { id: `social-${platform.key}`, placeholder: platform.placeholder, value: creator.social[platform.key] ?? "" });
		return { platform, input };
	});
	const saveSocial = el("button", { class: "button primary" }, "Save links");

	saveSocial.addEventListener("click", async () => {
		const social: Record<string, string> = {};
		for (const { platform, input } of socialInputs) {
			const value = input.value.trim();
			if (value.length > 0) social[platform.key] = value;
		}

		saveSocial.disabled = true;
		try {
			await api.updateSocial(social);
			toast("Links saved.", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not save links.", "error");
		} finally {
			saveSocial.disabled = false;
		}
	});

	const homeTemplate = el("textarea", {
		id: "home-template",
		class: "code customization-editor",
		rows: "14",
		spellcheck: "false",
		placeholder: "Leave empty to use the standard Bloggy home page.",
	});
	homeTemplate.value = customization.homeTemplate;
	const postTemplate = el("textarea", {
		id: "post-template",
		class: "code customization-editor",
		rows: "14",
		spellcheck: "false",
		placeholder: "Leave empty to use the standard Bloggy post page.",
	});
	postTemplate.value = customization.postTemplate;
	const customCss = el("textarea", {
		id: "custom-css",
		class: "code customization-editor css-editor",
		rows: "14",
		spellcheck: "false",
		placeholder: ".custom-home {\n  max-width: 72rem;\n  margin: 0 auto;\n}",
	});
	customCss.value = customization.customCss;
	const saveCustomization = el("button", { class: "button primary" }, "Save customization");
	const starterTemplates = el("button", { class: "button ghost" }, "Load starter templates");
	const restoreTemplates = el("button", { class: "button quiet danger" }, "Restore Bloggy defaults");

	saveCustomization.addEventListener("click", async () => {
		saveCustomization.disabled = true;
		try {
			await api.updateCustomization({
				customCss: customCss.value,
				homeTemplate: homeTemplate.value,
				postTemplate: postTemplate.value,
			});
			toast("Customization saved.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not save the customization.", "error");
		} finally {
			saveCustomization.disabled = false;
		}
	});

	starterTemplates.addEventListener("click", async () => {
		if (
			(homeTemplate.value.trim() !== "" || postTemplate.value.trim() !== "") &&
			!(await confirm({
				title: "Replace your templates?",
				body: [el("p", {}, "This replaces the text currently in both template editors. Your saved version remains active until you save again.")],
				confirmLabel: "Load starters",
			}))
		)
			return;
		homeTemplate.value = HOME_STARTER_TEMPLATE;
		postTemplate.value = POST_STARTER_TEMPLATE;
		homeTemplate.focus();
	});

	restoreTemplates.addEventListener("click", async () => {
		if (
			!(await confirm({
				title: "Restore Bloggy defaults?",
				body: [el("p", {}, "Your custom HTML and CSS will be removed. Your colors and other blog settings stay unchanged.")],
				confirmLabel: "Restore defaults",
				danger: true,
			}))
		)
			return;

		restoreTemplates.disabled = true;
		try {
			await api.updateCustomization({ customCss: "", homeTemplate: "", postTemplate: "" });
			toast("Bloggy templates restored.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not restore the templates.", "error");
		} finally {
			restoreTemplates.disabled = false;
		}
	});

	const componentList = (items: readonly string[]) =>
		el("div", { class: "component-list" }, ...items.map((component) => el("code", {}, `<${component}></${component}>`)));

	async function changePassword(): Promise<void> {
		const values = await modal({
			title: "Change password",
			body: [
				field("Current password", "current", "password"),
				field("New password", "next", "password"),
				el("p", { class: "help" }, `At least ${instanceConfig().minPasswordEntropy} bits of entropy. All other sessions will be signed out.`),
			],
			confirmLabel: "Change password",
		});
		if (values === null) return;

		const next = values.next ?? "";
		if (PasswordEntropy.calculate(next) < instanceConfig().minPasswordEntropy) {
			toast("That password is too weak.", "error");
			return;
		}

		try {
			await api.changePassword(values.current ?? "", next);
			toast("Password changed. Other devices have been signed out.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not change the password.", "error");
		}
	}

	async function enableTwoFactor(): Promise<void> {
		let enrollment: Awaited<ReturnType<typeof api.beginTwoFactor>>;
		try {
			enrollment = await api.beginTwoFactor();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not start setup.", "error");
			return;
		}

		const svg = QRCode.encode(enrollment.uri, { errorCorrectionLevel: ErrorCorrectionLevel.QUARTILE }).toSVG({ scale: 6, margin: 2 });
		const qr = el("div", { class: "qr" });
		setHtml(qr, svg);

		const values = await modal({
			title: "Enable two-factor authentication",
			body: [
				el("p", {}, "Scan this with your authenticator app, then enter the six-digit code it shows."),
				qr,
				el("p", { class: "help", style: "text-align:center" }, "Can't scan? Enter this key manually:"),
				el("p", { class: "secret" }, enrollment.secret),
				field("Six-digit code", "code", "text", "123456"),
			],
			confirmLabel: "Enable",
		});
		if (values === null) return;

		try {
			const result = await api.confirmTwoFactor(enrollment.enrollment, (values.code ?? "").trim());
			await modal({ title: "Save your backup codes", body: [backupCodes(result.backupCodes)], confirmLabel: "I've saved them" });
			toast("Two-factor authentication enabled.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "That code was not accepted.", "error");
		}
	}

	async function disableTwoFactor(): Promise<void> {
		const values = await modal({
			title: "Disable two-factor authentication",
			body: [
				el("p", {}, "This makes your account easier to compromise."),
				field("Password", "password", "password"),
				field("Authenticator or backup code", "otp", "text", "123456"),
			],
			confirmLabel: "Disable",
			danger: true,
		});
		if (values === null) return;

		try {
			await api.disableTwoFactor(values.password ?? "", (values.otp ?? "").trim());
			toast("Two-factor authentication disabled.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not disable two-factor.", "error");
		}
	}

	async function newBackupCodes(): Promise<void> {
		const values = await modal({
			title: "Generate new backup codes",
			body: [
				el("p", {}, "Your existing codes stop working immediately."),
				field("Password", "password", "password"),
				field("Authenticator code", "otp", "text", "123456"),
			],
			confirmLabel: "Generate",
		});
		if (values === null) return;

		try {
			const result = await api.regenerateBackupCodes(values.password ?? "", (values.otp ?? "").trim());
			await modal({ title: "Your new backup codes", body: [backupCodes(result.backupCodes)], confirmLabel: "I've saved them" });
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not generate codes.", "error");
		}
	}

	async function revoke(session: Session): Promise<void> {
		try {
			await api.revokeSession(session.id);
			toast("Session revoked.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not revoke the session.", "error");
		}
	}

	async function revokeOthers(): Promise<void> {
		if (
			!(await confirm({
				title: "Sign out everywhere else?",
				body: [el("p", {}, "Every other device will need to sign in again.")],
				confirmLabel: "Sign out others",
			}))
		)
			return;

		try {
			await api.revokeOtherSessions();
			toast("Other sessions signed out.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not revoke sessions.", "error");
		}
	}

	async function deleteAccount(): Promise<void> {
		const values = await modal({
			title: "Delete your account",
			body: [
				el("p", {}, "This permanently removes your blog, every post, every image and all view history. It cannot be undone."),
				field("Password", "password", "password"),
				...(creator.twoFactorEnabled ? [field("Authenticator code", "otp", "text", "123456")] : []),
				field(`Type your username (${creator.username}) to confirm`, "confirm", "text"),
			],
			confirmLabel: "Delete everything",
			danger: true,
		});
		if (values === null) return;

		if ((values.confirm ?? "").trim() !== creator.username) {
			toast("Username did not match. Nothing was deleted.", "error");
			return;
		}

		try {
			await api.deleteAccount(values.password ?? "", (values.otp ?? "").trim() || undefined);
			clearSession();
			toast("Your account has been deleted.", "info");
			navigate("/");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not delete the account.", "error");
		}
	}

	render(
		root,
		el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Settings"), el("p", {}, `Signed in as ${accountUsername}`))),
		!isOwner &&
			el(
				"div",
				{ class: "review-banner" },
				el("strong", {}, `${creator.membership.role.charAt(0).toUpperCase()}${creator.membership.role.slice(1)} access`),
				el("p", {}, `You are collaborating on ${creator.title}. The blog owner manages its public settings and your role.`),
			),

		isOwner &&
			el(
				"div",
				{ class: "card" },
				el("h2", {}, "Blog"),
				el("p", { class: "hint" }, "How your blog appears to readers and in search results."),
				el("div", { class: "row" }, labelled("Title", title), labelled("Author name", author)),
				labelled("Description", description, "30 to 160 characters."),
				el("div", { class: "row" }, labelled("Category", category), labelled("Language", language), labelled("Theme", theme)),
				colorPicker,
				el("div", { class: "actions" }, saveSettings),
			),

		isOwner &&
			el(
				"div",
				{ class: "card" },
				el("h2", {}, "Avatar"),
				el("p", { class: "hint" }, "Shown on your blog and next to every post."),
				el(
					"div",
					{ class: "actions" },
					avatarImage,
					el("button", { class: "button ghost", onClick: () => avatarInput.click() }, "Upload new avatar"),
					avatarInput,
				),
			),

		isOwner &&
			el(
				"div",
				{ class: "card" },
				el("h2", {}, "Links"),
				el("p", { class: "hint" }, "Shown under your blog's title. Leave a field empty to hide it."),
				el("div", { class: "row" }, ...socialInputs.map(({ platform, input }) => labelled(platform.label, input))),
				el("div", { class: "actions" }, saveSocial),
			),

		isOwner &&
			el(
				"div",
				{ class: "card customization-card" },
				el(
					"div",
					{ class: "card-top" },
					el("div", {}, el("h2", {}, "Advanced customization"), el("p", { class: "hint" }, "Build a unique layout with HTML components and your own CSS.")),
				),
				el(
					"div",
					{ class: "customization-notice" },
					el("strong", {}, "Designed to stay safe"),
					el(
						"p",
						{},
						"Scripts, forms, embedded pages, event handlers and unsafe links are blocked. Bloggy keeps metadata and dynamic content working for you.",
					),
				),
				el(
					"details",
					{ class: "customization-section", open: customization.homeTemplate.length > 0 },
					el("summary", {}, el("span", {}, "Creator home template"), el("small", {}, "HTML")),
					el("p", { class: "help" }, "Arrange these components inside your own semantic HTML. The posts component is required."),
					componentList(HOME_TEMPLATE_COMPONENTS),
					labelled("Home template", homeTemplate),
				),
				el(
					"details",
					{ class: "customization-section", open: customization.postTemplate.length > 0 },
					el("summary", {}, el("span", {}, "Post template"), el("small", {}, "HTML")),
					el("p", { class: "help" }, "The post content component is required. Other components can be omitted or moved."),
					componentList(POST_TEMPLATE_COMPONENTS),
					labelled("Post template", postTemplate),
				),
				el(
					"details",
					{ class: "customization-section", open: customization.customCss.length > 0 },
					el("summary", {}, el("span", {}, "Custom stylesheet"), el("small", {}, "CSS")),
					el("p", { class: "help" }, "Your CSS loads after the Bloggy stylesheet and applies to both public page types."),
					labelled("Custom CSS", customCss),
				),
				el(
					"div",
					{ class: "actions customization-actions" },
					saveCustomization,
					starterTemplates,
					el("a", { class: "button ghost", href: `/creator/${creator.username}`, target: "_blank", rel: "noopener" }, "Open blog"),
					restoreTemplates,
				),
			),

		el(
			"div",
			{ class: "card" },
			el("h2", {}, "Security"),
			el("p", { class: "hint" }, "Your email is ", el("strong", {}, creator.email), ", used only for account recovery."),
			isOwner &&
				el(
					"div",
					{ class: "actions", style: "margin-bottom:1rem" },
					el("span", {}, "Two-factor authentication "),
					el("span", { class: `badge ${creator.twoFactorEnabled ? "on" : "off"}` }, creator.twoFactorEnabled ? "Enabled" : "Disabled"),
					creator.twoFactorEnabled && el("span", { class: "help" }, `${backupCodesRemaining} backup codes left`),
				),
			el(
				"div",
				{ class: "actions" },
				el("button", { class: "button ghost", onClick: () => void changePassword() }, "Change password"),
				isOwner &&
					(creator.twoFactorEnabled
						? el("button", { class: "button danger", onClick: () => void disableTwoFactor() }, "Disable two-factor")
						: el("button", { class: "button primary", onClick: () => void enableTwoFactor() }, "Enable two-factor")),
				isOwner && creator.twoFactorEnabled && el("button", { class: "button ghost", onClick: () => void newBackupCodes() }, "New backup codes"),
			),
		),

		el(
			"div",
			{ class: "card" },
			el("h2", {}, "Active sessions"),
			el("p", { class: "hint" }, "Devices currently signed in to your account."),
			el(
				"table",
				{ class: "data" },
				el("thead", {}, el("tr", {}, el("th", {}, "Device"), el("th", {}, "IP"), el("th", {}, "Last used"), el("th", {}, ""))),
				el(
					"tbody",
					{},
					...sessions.map((session) =>
						el(
							"tr",
							{},
							el("td", {}, session.userAgent ?? "Unknown", session.current ? el("span", { class: "badge on", style: "margin-left:.5rem" }, "This device") : ""),
							el("td", {}, session.ip ?? "-"),
							el("td", {}, formatDateTime(session.lastUsedAt)),
							el("td", {}, session.current ? "" : el("button", { class: "button small ghost", onClick: () => void revoke(session) }, "Revoke")),
						),
					),
				),
			),
			sessions.length > 1 &&
				el(
					"div",
					{ class: "actions", style: "margin-top:1rem" },
					el("button", { class: "button ghost", onClick: () => void revokeOthers() }, "Sign out everywhere else"),
				),
		),

		isOwner &&
			el(
				"div",
				{ class: "card", style: "border-color:var(--danger)" },
				el("h2", {}, "Delete account"),
				el("p", { class: "hint" }, "Removes your blog, posts, images and history permanently."),
				el("div", { class: "actions" }, el("button", { class: "button danger", onClick: () => void deleteAccount() }, "Delete my account")),
			),
	);
}
