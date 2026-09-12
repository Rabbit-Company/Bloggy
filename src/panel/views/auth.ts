import PasswordEntropy from "@rabbit-company/password-entropy";
import PasswordGenerator from "@rabbit-company/password-generator";
import { ApiError, ErrorCode, api } from "../api.ts";
import { clearSession, setCreator } from "../session.ts";
import { CATEGORIES, LANGUAGES, THEMES, instanceConfig } from "../constants.ts";
import { el, render, toast } from "../ui.ts";
import { navigate, panelUrl } from "../router.ts";

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

function attachStrengthMeter(input: HTMLInputElement): HTMLElement {
	const bar = el("span");
	const meter = el("div", { class: "meter" }, bar);
	const required = instanceConfig().minPasswordEntropy;
	const caption = el("span", { class: "help" }, `Needs at least ${required} bits of entropy.`);

	input.addEventListener("input", () => {
		const bits = input.value.length === 0 ? 0 : PasswordEntropy.calculate(input.value);
		const ratio = Math.min(1, bits / (required * 1.4));
		bar.style.width = `${ratio * 100}%`;

		meter.classList.toggle("ok", bits >= required);
		meter.classList.toggle("mid", bits >= required * 0.6 && bits < required);

		caption.textContent =
			input.value.length === 0
				? `Needs at least ${required} bits of entropy.`
				: `${Math.round(bits)} bits, ${bits >= required ? "strong enough" : "too weak"}.`;
	});

	return el("div", {}, meter, caption);
}

export function renderLogin(root: HTMLElement): void {
	const username = el("input", { id: "username", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false" });
	const password = el("input", { id: "password", name: "password", type: "password", autocomplete: "current-password" });
	const otp = el("input", { id: "otp", name: "otp", inputmode: "text", autocomplete: "one-time-code", placeholder: "123456" });

	const otpField = labelled("Two-factor code", otp, "Six digits from your authenticator, or a backup code.");
	otpField.hidden = true;

	const submit = el("button", { class: "button primary", type: "submit" }, "Sign in");

	async function attempt(event: Event): Promise<void> {
		event.preventDefault();
		submit.disabled = true;

		try {
			const result = await api.login(username.value.trim(), password.value, otpField.hidden ? undefined : otp.value.trim());
			setCreator(result.creator);
			navigate("/posts");
		} catch (err) {
			if (err instanceof ApiError && err.code === ErrorCode.OTP_REQUIRED) {
				otpField.hidden = false;
				otp.focus();
				toast("Enter the code from your authenticator app.", "info");
			} else if (err instanceof ApiError && err.code === ErrorCode.EMAIL_NOT_CONFIRMED) {
				renderConfirmationSent(root, username.value.trim().toLowerCase(), err.message);
			} else {
				toast(err instanceof Error ? err.message : "Sign in failed.", "error");
			}
		} finally {
			submit.disabled = false;
		}
	}

	const form = el("form", { onSubmit: attempt }, labelled("Username", username), labelled("Password", password), otpField, submit);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Welcome back"),
				el("p", { class: "sub" }, "Sign in to your Bloggy panel."),
				form,
				instanceConfig().passwordResetEnabled &&
					el("p", { class: "auth-switch" }, el("a", { href: panelUrl("/forgot-password"), onClick: link("/forgot-password") }, "Forgot your password?")),
				instanceConfig().emailConfirmationEnabled &&
					el(
						"p",
						{ class: "auth-switch" },
						el("a", { href: panelUrl("/resend-confirmation"), onClick: link("/resend-confirmation") }, "Didn't receive a confirmation email?"),
					),
				el("p", { class: "auth-switch" }, "No account yet? ", el("a", { href: panelUrl("/register"), onClick: link("/register") }, "Create one")),
			),
		),
	);

	username.focus();
}

export function renderForgotPassword(root: HTMLElement): void {
	if (!instanceConfig().passwordResetEnabled) {
		render(
			root,
			el(
				"div",
				{ class: "auth" },
				el(
					"div",
					{ class: "auth-card" },
					el("h1", {}, "Password reset unavailable"),
					el("p", { class: "sub" }, "Email delivery is not configured on this instance."),
					el("a", { class: "button ghost", href: panelUrl("/") }, "Back to sign in"),
				),
			),
		);
		return;
	}

	const username = el("input", {
		id: "reset-username",
		name: "username",
		autocomplete: "username",
		autocapitalize: "none",
		spellcheck: "false",
	});
	const submit = el("button", { class: "button primary", type: "submit" }, "Email reset link");
	const form = el(
		"form",
		{
			onSubmit: async (event: Event) => {
				event.preventDefault();
				submit.disabled = true;
				try {
					const result = await api.requestPasswordReset(username.value.trim().toLowerCase());
					render(
						root,
						el(
							"div",
							{ class: "auth" },
							el(
								"div",
								{ class: "auth-card" },
								el("h1", {}, "Check your email"),
								el("p", { class: "sub" }, result.message),
								el("a", { class: "button ghost", href: panelUrl("/") }, "Back to sign in"),
							),
						),
					);
				} catch (err) {
					toast(err instanceof Error ? err.message : "Could not request a password reset.", "error");
					submit.disabled = false;
				}
			},
		},
		labelled("Account username", username, "We will email the address registered to this account."),
		submit,
	);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Reset your password"),
				el("p", { class: "sub" }, "Enter the username you use to sign in."),
				form,
				el("p", { class: "auth-switch" }, el("a", { href: panelUrl("/") }, "Back to sign in")),
			),
		),
	);
	username.focus();
}

export async function renderResetPassword(root: HTMLElement, token: string): Promise<void> {
	render(root, el("div", { class: "auth" }, el("div", { class: "auth-card" }, el("span", { class: "spinner" }), " Checking reset link…")));
	try {
		await api.validatePasswordReset(token);
	} catch (err) {
		render(
			root,
			el(
				"div",
				{ class: "auth" },
				el(
					"div",
					{ class: "auth-card" },
					el("h1", {}, "Reset link unavailable"),
					el("p", { class: "sub" }, err instanceof Error ? err.message : "This reset link cannot be used."),
					el("a", { class: "button ghost", href: panelUrl("/forgot-password") }, "Request another link"),
				),
			),
		);
		return;
	}

	const password = el("input", { id: "reset-password", type: "password", autocomplete: "new-password" });
	const generate = el("button", { class: "button ghost small", type: "button" }, "Generate");
	generate.addEventListener("click", () => {
		password.type = "text";
		password.value = PasswordGenerator.generate(24, true, true, true);
		password.dispatchEvent(new Event("input"));
	});
	const submit = el("button", { class: "button primary", type: "submit" }, "Set new password");
	const form = el(
		"form",
		{
			onSubmit: async (event: Event) => {
				event.preventDefault();
				submit.disabled = true;
				try {
					await api.resetPassword(token, password.value);
					clearSession();
					render(
						root,
						el(
							"div",
							{ class: "auth" },
							el(
								"div",
								{ class: "auth-card" },
								el("h1", {}, "Password updated"),
								el("p", { class: "sub" }, "Every existing session has been signed out. You can now use your new password."),
								el("a", { class: "button primary", href: panelUrl("/") }, "Sign in"),
							),
						),
					);
				} catch (err) {
					toast(err instanceof Error ? err.message : "Could not reset the password.", "error");
					submit.disabled = false;
				}
			},
		},
		el(
			"div",
			{},
			el("label", { class: "field", for: password.id }, el("span", {}, "New password"), password),
			attachStrengthMeter(password),
			el("div", { class: "actions", style: "margin-top:.5rem" }, generate),
		),
		submit,
	);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Choose a new password"),
				el("p", { class: "sub" }, "The reset link works once and expires automatically."),
				form,
			),
		),
	);
	password.focus();
}

function renderConfirmationSent(
	root: HTMLElement,
	username: string,
	message = "We sent a confirmation link to the email address registered to this account.",
): void {
	const resend = el("button", { class: "button ghost", type: "button" }, "Send another link");
	resend.addEventListener("click", async () => {
		resend.disabled = true;
		try {
			const result = await api.requestEmailConfirmation(username);
			toast(result.message, "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not request another confirmation email.", "error");
		} finally {
			resend.disabled = false;
		}
	});

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Check your email"),
				el("p", { class: "sub" }, message),
				resend,
				el("p", { class: "auth-switch" }, el("a", { href: panelUrl("/"), onClick: link("/") }, "Back to sign in")),
			),
		),
	);
}

export function renderEmailConfirmationRequest(root: HTMLElement): void {
	if (!instanceConfig().emailConfirmationEnabled) {
		render(
			root,
			el(
				"div",
				{ class: "auth" },
				el(
					"div",
					{ class: "auth-card" },
					el("h1", {}, "Email confirmation unavailable"),
					el("p", { class: "sub" }, "Email delivery is not configured on this instance."),
					el("a", { class: "button ghost", href: panelUrl("/") }, "Back to sign in"),
				),
			),
		);
		return;
	}

	const username = el("input", {
		id: "confirmation-username",
		name: "username",
		autocomplete: "username",
		autocapitalize: "none",
		spellcheck: "false",
	});
	const submit = el("button", { class: "button primary", type: "submit" }, "Email confirmation link");
	const form = el(
		"form",
		{
			onSubmit: async (event: Event) => {
				event.preventDefault();
				submit.disabled = true;
				try {
					const normalized = username.value.trim().toLowerCase();
					const result = await api.requestEmailConfirmation(normalized);
					renderConfirmationSent(root, normalized, result.message);
				} catch (err) {
					toast(err instanceof Error ? err.message : "Could not request a confirmation email.", "error");
					submit.disabled = false;
				}
			},
		},
		labelled("Account username", username),
		submit,
	);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Confirm your email"),
				el("p", { class: "sub" }, "Enter the username you used when creating your blog."),
				form,
				el("p", { class: "auth-switch" }, el("a", { href: panelUrl("/"), onClick: link("/") }, "Back to sign in")),
			),
		),
	);
	username.focus();
}

export async function renderConfirmEmail(root: HTMLElement, token: string): Promise<void> {
	render(root, el("div", { class: "auth" }, el("div", { class: "auth-card" }, el("span", { class: "spinner" }), " Checking confirmation link…")));
	try {
		await api.validateEmailConfirmation(token);
	} catch (err) {
		render(
			root,
			el(
				"div",
				{ class: "auth" },
				el(
					"div",
					{ class: "auth-card" },
					el("h1", {}, "Confirmation link unavailable"),
					el("p", { class: "sub" }, err instanceof Error ? err.message : "This confirmation link cannot be used."),
					el("a", { class: "button ghost", href: panelUrl("/resend-confirmation") }, "Request another link"),
				),
			),
		);
		return;
	}

	const confirm = el("button", { class: "button primary", type: "button" }, "Confirm email address");
	confirm.addEventListener("click", async () => {
		confirm.disabled = true;
		try {
			await api.confirmEmail(token);
			render(
				root,
				el(
					"div",
					{ class: "auth" },
					el(
						"div",
						{ class: "auth-card" },
						el("h1", {}, "Email confirmed"),
						el("p", { class: "sub" }, "Your account is ready. You can now sign in."),
						el("a", { class: "button primary", href: panelUrl("/") }, "Sign in"),
					),
				),
			);
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not confirm this email address.", "error");
			confirm.disabled = false;
		}
	});

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("h1", {}, "Confirm your email"),
				el("p", { class: "sub" }, "This verifies the recovery address for your Bloggy account."),
				confirm,
			),
		),
	);
}

export function renderRegister(root: HTMLElement): void {
	const username = el("input", {
		id: "username",
		name: "username",
		autocomplete: "username",
		autocapitalize: "none",
		spellcheck: "false",
		placeholder: "your-name",
	});
	const email = el("input", { id: "email", name: "email", type: "email", autocomplete: "email" });
	const password = el("input", { id: "password", name: "password", type: "password", autocomplete: "new-password" });

	const generate = el(
		"button",
		{
			type: "button",
			class: "button ghost small",
			onClick: () => {
				password.type = "text";
				password.value = PasswordGenerator.generate(24, true, true, true);
				password.dispatchEvent(new Event("input"));
			},
		},
		"Generate",
	);

	const title = el("input", { id: "title", name: "title", placeholder: "My Blog", maxlength: "30" });
	const description = el("textarea", { id: "description", name: "description", maxlength: "160", rows: "3" });
	const author = el("input", { id: "author", name: "author", placeholder: "Your name", maxlength: "30" });
	const category = select("category", CATEGORIES, "Technology");
	const language = select("language", LANGUAGES, "en");
	const theme = select("theme", THEMES, "light");

	username.addEventListener("input", () => {
		if (title.dataset.touched !== "true" && username.value.length > 0) {
			title.value = `${username.value.charAt(0).toUpperCase()}${username.value.slice(1)}`.slice(0, 30);
		}
	});
	title.addEventListener("input", () => {
		title.dataset.touched = "true";
	});

	const submit = el("button", { class: "button primary", type: "submit" }, "Create account");

	async function attempt(event: Event): Promise<void> {
		event.preventDefault();

		if (description.value.trim().length < 30) {
			toast("The description needs to be at least 30 characters.", "error");
			description.focus();
			return;
		}

		submit.disabled = true;
		try {
			const created = await api.register({
				username: username.value.trim().toLowerCase(),
				password: password.value,
				email: email.value.trim(),
				title: title.value.trim(),
				description: description.value.trim(),
				author: author.value.trim(),
				category: category.value,
				language: language.value,
				theme: theme.value,
			});
			if (created.emailConfirmationRequired) {
				renderConfirmationSent(root, created.username);
				return;
			}

			const result = await api.login(username.value.trim().toLowerCase(), password.value);
			setCreator(result.creator);
			toast("Welcome to Bloggy.", "success");
			navigate("/posts");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Registration failed.", "error");
		} finally {
			submit.disabled = false;
		}
	}

	const form = el(
		"form",
		{ onSubmit: attempt },
		labelled("Username", username, "Lowercase letters, numbers and hyphens. This becomes your blog's address."),
		labelled("Email", email, "Used only for account recovery. Never published."),
		el(
			"div",
			{},
			el("label", { class: "field", for: "password" }, el("span", {}, "Password"), password),
			attachStrengthMeter(password),
			el("div", { class: "actions", style: "margin-top:.5rem" }, generate),
		),
		el("hr", { style: "border:0;border-top:1px solid var(--border);margin:1.5rem 0" }),
		labelled("Blog title", title, "3 to 30 characters."),
		labelled("Blog description", description, "30 to 160 characters. Shown in search results and link previews."),
		labelled("Author name", author, "5 to 30 characters."),
		el("div", { class: "row" }, labelled("Category", category), labelled("Language", language), labelled("Theme", theme)),
		submit,
	);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card wide" },
				el("h1", {}, "Create your blog"),
				el("p", { class: "sub" }, "It takes about a minute."),
				form,
				el("p", { class: "auth-switch" }, "Already have an account? ", el("a", { href: panelUrl("/"), onClick: link("/") }, "Sign in")),
			),
		),
	);

	username.focus();
}

export async function renderInvite(root: HTMLElement, token: string): Promise<void> {
	render(root, el("div", { class: "auth" }, el("div", { class: "auth-card" }, el("span", { class: "spinner" }), " Checking invitation…")));

	let invite: Awaited<ReturnType<typeof api.invitation>>;
	try {
		invite = await api.invitation(token);
	} catch (err) {
		render(
			root,
			el(
				"div",
				{ class: "auth" },
				el(
					"div",
					{ class: "auth-card" },
					el("h1", {}, "Invitation unavailable"),
					el("p", { class: "sub" }, err instanceof Error ? err.message : "This invitation cannot be used."),
					el("a", { class: "button ghost", href: panelUrl("/") }, "Go to sign in"),
				),
			),
		);
		return;
	}

	const username = el("input", {
		id: "invite-username",
		autocomplete: "username",
		autocapitalize: "none",
		spellcheck: "false",
		placeholder: "your-name",
	});
	const password = el("input", { id: "invite-password", type: "password", autocomplete: "new-password" });
	const generate = el("button", { class: "button ghost small", type: "button" }, "Generate");
	generate.addEventListener("click", () => {
		password.type = "text";
		password.value = PasswordGenerator.generate(24, true, true, true);
		password.dispatchEvent(new Event("input"));
	});
	const submit = el("button", { class: "button primary", type: "submit" }, "Join team");

	const form = el(
		"form",
		{
			onSubmit: async (event: Event) => {
				event.preventDefault();
				submit.disabled = true;
				try {
					const normalized = username.value.trim().toLowerCase();
					await api.acceptInvitation(token, normalized, password.value);
					const signedIn = await api.login(normalized, password.value);
					setCreator(signedIn.creator);
					toast(`Welcome to ${invite.blog.title}.`, "success");
					navigate("/posts");
				} catch (err) {
					toast(err instanceof Error ? err.message : "Could not accept the invitation.", "error");
				} finally {
					submit.disabled = false;
				}
			},
		},
		labelled("Your username", username, "This is your personal sign-in name, not the blog address."),
		labelled("Invited email", el("input", { id: "invite-email", value: invite.email, disabled: true })),
		el(
			"div",
			{},
			el("label", { class: "field", for: password.id }, el("span", {}, "Password"), password),
			attachStrengthMeter(password),
			el("div", { class: "actions", style: "margin-top:.5rem" }, generate),
		),
		submit,
	);

	render(
		root,
		el(
			"div",
			{ class: "auth" },
			el(
				"div",
				{ class: "auth-card" },
				el("span", { class: "badge on invite-role-badge" }, `${invite.role} invitation`),
				el("h1", {}, `Join ${invite.blog.title}`),
				el("p", { class: "sub" }, `${invite.blog.author} invited you to collaborate. Create your own secure sign-in to continue.`),
				form,
			),
		),
	);
	username.focus();
}

function link(path: string): EventListener {
	return (event: Event) => {
		event.preventDefault();
		navigate(path);
	};
}
