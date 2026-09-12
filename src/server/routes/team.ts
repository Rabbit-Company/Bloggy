import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { creatorExists, findCreator } from "../db/creators.ts";
import { deleteSessionsByCreator } from "../db/sessions.ts";
import {
	acceptTeamInvite,
	createTeamInvite,
	deleteTeamInvite,
	deleteTeamMember,
	findTeamInvite,
	isTeamRole,
	listTeamInvites,
	listTeamMembers,
	teamMemberExists,
	updateTeamMemberRole,
} from "../db/team.ts";
import { hashPassword, passwordEntropy } from "../lib/crypto.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import { assertValid, isEmailValid, isPasswordValid, isUsernameValid } from "../lib/validation.ts";
import { requireOwner } from "../middleware/auth.ts";
import type { AppState } from "../types.ts";
import { logger } from "../lib/logger.ts";
import { deletePasswordResetTokens } from "../db/password-resets.ts";
import { panelTokenUrl } from "../lib/links.ts";

export function teamRoutes(app: Web<AppState>): void {
	app.get("/api/v1/team", requireOwner(), async (ctx) => {
		const username = ctx.get("creator").username;
		return ok(ctx, {
			members: await listTeamMembers(username),
			invitations: await listTeamInvites(username),
		});
	});

	app.post("/api/v1/team/invitations", requireOwner(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["email", "role"]);
		assertValid(body.email, isEmailValid, ErrorCode.INVALID_EMAIL);
		if (!isTeamRole(body.role)) throw new ApiError(ErrorCode.INVALID_TEAM_ROLE);

		const created = await createTeamInvite(ctx.get("creator").username, body.email.toLowerCase(), body.role);
		logger.audit("Team invitation created", {
			username: ctx.get("creator").username,
			role: body.role,
		});
		return ok(
			ctx,
			{
				invitation: created.invite,
				inviteUrl: panelTokenUrl("invite", created.token),
			},
			201,
		);
	});

	app.delete("/api/v1/team/invitations/:id", requireOwner(), async (ctx) => {
		const removed = await deleteTeamInvite(ctx.get("creator").username, ctx.params.id ?? "");
		if (removed === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No such invitation.");
		logger.audit("Team invitation revoked", { username: ctx.get("creator").username });
		return ok(ctx);
	});

	app.put("/api/v1/team/members/:username", requireOwner(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["role"]);
		if (!isTeamRole(body.role)) throw new ApiError(ErrorCode.INVALID_TEAM_ROLE);
		const removed = await updateTeamMemberRole(ctx.get("creator").username, ctx.params.username ?? "", body.role);
		if (removed === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No such team member.");
		logger.audit(`Team role updated: ${ctx.params.username}`, {
			username: ctx.get("creator").username,
			member: ctx.params.username,
			role: body.role,
		});
		return ok(ctx);
	});

	app.delete("/api/v1/team/members/:username", requireOwner(), async (ctx) => {
		const username = ctx.params.username ?? "";
		const removed = await deleteTeamMember(ctx.get("creator").username, username);
		if (removed === 0) throw new ApiError(ErrorCode.NOT_FOUND, "No such team member.");
		await deleteSessionsByCreator(username);
		await deletePasswordResetTokens(username);
		logger.audit(`Team member removed: ${username}`, { username: ctx.get("creator").username, member: username });
		return ok(ctx);
	});

	app.post("/api/v1/team/invitations/lookup", async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		const token = body.token;
		if (typeof token !== "string" || !/^[A-Za-z0-9]{64}$/.test(token)) throw new ApiError(ErrorCode.INVITE_INVALID);
		const invite = await findTeamInvite(token);
		if (invite === null) throw new ApiError(ErrorCode.INVITE_INVALID);
		const creator = await findCreator(invite.blog_username);
		if (creator === null || creator.suspended_at !== null) throw new ApiError(ErrorCode.INVITE_INVALID);
		return ok(ctx, {
			email: invite.email,
			role: invite.role,
			blog: { username: creator.username, title: creator.title, author: creator.author },
			expiresAt: invite.expires_at,
		});
	});

	app.post("/api/v1/team/invitations/accept", async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["token", "username", "password"]);
		if (typeof body.token !== "string" || !/^[A-Za-z0-9]{64}$/.test(body.token)) throw new ApiError(ErrorCode.INVITE_INVALID);
		assertValid(body.username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		assertValid(body.password, isPasswordValid, ErrorCode.INVALID_PASSWORD);

		const entropy = passwordEntropy(body.password);
		if (entropy < config.limits.minPasswordEntropy) {
			throw new ApiError(ErrorCode.PASSWORD_TOO_WEAK, undefined, {
				entropy: Math.round(entropy),
				required: config.limits.minPasswordEntropy,
			});
		}

		const token = body.token;
		const invite = await findTeamInvite(token);
		if (invite === null) throw new ApiError(ErrorCode.INVITE_INVALID);
		if ((await creatorExists(body.username)) || (await teamMemberExists(body.username))) throw new ApiError(ErrorCode.USERNAME_TAKEN);

		const accepted = await acceptTeamInvite(token, body.username, await hashPassword(body.password));
		if (accepted === null) throw new ApiError(ErrorCode.INVITE_INVALID);
		logger.audit(`Team invitation accepted: ${body.username}`, {
			username: accepted.blog_username,
			member: body.username,
			role: accepted.role,
		});
		return ok(ctx, { blogUsername: accepted.blog_username }, 201);
	});
}
