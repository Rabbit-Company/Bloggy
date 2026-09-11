import PasswordEntropy from "@rabbit-company/password-entropy";
import PasswordGenerator from "@rabbit-company/password-generator";
import { ApiError, ErrorCode, api } from "../api.ts";
import { setCreator } from "../session.ts";
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
				el("p", { class: "auth-switch" }, "No account yet? ", el("a", { href: panelUrl("/register"), onClick: link("/register") }, "Create one")),
			),
		),
	);

	username.focus();
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
			await api.register({
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

function link(path: string): EventListener {
	return (event: Event) => {
		event.preventDefault();
		navigate(path);
	};
}
