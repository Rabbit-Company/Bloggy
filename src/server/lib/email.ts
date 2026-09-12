import nodemailer from "nodemailer";
import { config } from "../config.ts";
import { escapeHtml } from "../ssr/markdown.ts";

const transporter = config.smtp.enabled
	? nodemailer.createTransport({
			host: config.smtp.host,
			port: config.smtp.port,
			secure: config.smtp.secure,
			requireTLS: config.smtp.requireTls,
			connectionTimeout: 10_000,
			greetingTimeout: 10_000,
			socketTimeout: 30_000,
			...(config.smtp.user.length > 0 ? { auth: { user: config.smtp.user, pass: config.smtp.password } } : {}),
		})
	: null;

export interface TransactionalEmail {
	preview: string;
	label: string;
	title: string;
	message: string;
	actionLabel: string;
	actionUrl: string;
	notice: string;
	safety: string;
}

export function renderEmailHtml(email: TransactionalEmail, site = config.site.title, origin = config.server.domain): string {
	const safe = {
		preview: escapeHtml(email.preview),
		label: escapeHtml(email.label),
		title: escapeHtml(email.title),
		message: escapeHtml(email.message),
		actionLabel: escapeHtml(email.actionLabel),
		actionUrl: escapeHtml(email.actionUrl),
		notice: escapeHtml(email.notice),
		safety: escapeHtml(email.safety),
		site: escapeHtml(site),
		origin: escapeHtml(origin),
	};

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="color-scheme" content="light">
	<title>${safe.title}</title>
	<style>
		@media only screen and (max-width: 620px) {
			.email-shell { padding: 20px 12px !important; }
			.email-card { padding: 30px 22px !important; }
			.email-title { font-size: 28px !important; }
			.email-button { display: block !important; text-align: center !important; }
		}
	</style>
</head>
<body style="margin: 0; padding: 0; background: #f4f5fb; color: #111827; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
	<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${safe.preview}</div>
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; background: #f4f5fb; border-collapse: collapse;">
		<tr>
			<td class="email-shell" align="center" style="padding: 44px 16px;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px; border-collapse: separate;">
					<tr>
						<td style="padding: 0 4px 22px;">
							<table role="presentation" cellspacing="0" cellpadding="0" border="0">
								<tr>
									<td width="42" height="42" align="center" valign="middle" style="width: 42px; height: 42px; border-radius: 12px; background: #4f46e5; font-size: 23px; font-weight: 800; line-height: 42px;"><a href="${safe.origin}" aria-label="Visit ${safe.site}" style="display: block; color: #ffffff; text-decoration: none;">B</a></td>
									<td style="padding-left: 12px; font-size: 20px; font-weight: 750; letter-spacing: -0.02em;"><a href="${safe.origin}" style="color: #111827; text-decoration: none;">${safe.site}</a></td>
								</tr>
							</table>
						</td>
					</tr>
					<tr>
						<td class="email-card" style="padding: 46px 48px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 20px; box-shadow: 0 12px 32px rgba(17, 24, 39, 0.08);">
							<div style="display: inline-block; margin-bottom: 18px; padding: 7px 11px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;">${safe.label}</div>
							<h1 class="email-title" style="margin: 0 0 16px; color: #111827; font-size: 34px; line-height: 1.18; letter-spacing: -0.035em;">${safe.title}</h1>
							<p style="margin: 0 0 28px; color: #4b5563; font-size: 17px; line-height: 1.65;">${safe.message}</p>
							<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px;">
								<tr>
									<td style="border-radius: 11px; background: #4f46e5; box-shadow: 0 8px 18px rgba(79, 70, 229, 0.24);">
										<a class="email-button" href="${safe.actionUrl}" style="display: inline-block; padding: 14px 22px; color: #ffffff; font-size: 16px; font-weight: 750; line-height: 1.2; text-decoration: none;">${safe.actionLabel}</a>
									</td>
								</tr>
							</table>
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; margin-bottom: 26px; border-collapse: separate;">
								<tr>
									<td style="padding: 15px 17px; border: 1px solid #e0e7ff; border-radius: 12px; background: #f8faff; color: #3730a3; font-size: 14px; line-height: 1.55;">${safe.notice}</td>
								</tr>
							</table>
							<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px; line-height: 1.6;">${safe.safety}</p>
							<div style="padding-top: 22px; border-top: 1px solid #e5e7eb;">
								<p style="margin: 0 0 8px; color: #9ca3af; font-size: 12px; line-height: 1.5;">If the button does not work, copy this address into your browser.</p>
								<p style="margin: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; word-break: break-word;"><a href="${safe.actionUrl}" style="color: #6366f1; text-decoration: underline;">${safe.actionUrl}</a></p>
							</div>
						</td>
					</tr>
					<tr>
						<td align="center" style="padding: 22px 20px 0; color: #9ca3af; font-size: 12px; line-height: 1.55;">
							Sent by ${safe.site}<br>
							<a href="${safe.origin}" style="color: #8b93a1; text-decoration: underline;">${safe.origin}</a>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

export function passwordResetEmailEnabled(): boolean {
	return transporter !== null;
}

export function emailConfirmationEnabled(): boolean {
	return transporter !== null;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, expiresInSeconds: number): Promise<void> {
	if (transporter === null) throw new Error("SMTP is not configured");

	const minutes = Math.max(1, Math.round(expiresInSeconds / 60));
	const site = config.site.title;
	await transporter.sendMail({
		from: config.smtp.from,
		to,
		subject: `Reset your ${site} password`,
		text: `A password reset was requested for your ${site} account.\n\nReset it here: ${resetUrl}\n\nThis link expires in ${minutes} minutes and works once. If you did not request this, you can ignore this email.`,
		html: renderEmailHtml({
			preview: `Reset your ${site} password`,
			label: "Account security",
			title: "Reset your password",
			message: `We received a request to reset the password for your ${site} account.`,
			actionLabel: "Reset password",
			actionUrl: resetUrl,
			notice: `This link expires in ${minutes} minutes and can only be used once.`,
			safety: "If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.",
		}),
	});
}

export async function sendEmailConfirmation(to: string, confirmationUrl: string, expiresInSeconds: number): Promise<void> {
	if (transporter === null) throw new Error("SMTP is not configured");

	const hours = Math.max(1, Math.round(expiresInSeconds / 3_600));
	const site = config.site.title;
	await transporter.sendMail({
		from: config.smtp.from,
		to,
		subject: `Confirm your ${site} email`,
		text: `Welcome to ${site}.\n\nConfirm your email address here: ${confirmationUrl}\n\nThis link expires in ${hours} hours and works once. If you did not create this account, you can ignore this email.`,
		html: renderEmailHtml({
			preview: `Confirm your email address for ${site}`,
			label: `Welcome to ${site}`,
			title: "Confirm your email address",
			message: `Thanks for creating your ${site} account. Confirm this email address to finish setting up your blog.`,
			actionLabel: "Confirm email address",
			actionUrl: confirmationUrl,
			notice: `This link expires in ${hours} hours and can only be used once.`,
			safety: "If you did not create this account, you can safely ignore this email. No account access will be granted.",
		}),
	});
}
