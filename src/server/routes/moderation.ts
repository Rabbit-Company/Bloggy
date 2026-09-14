import { Web } from "@rabbit-company/web";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { ok } from "../lib/response.ts";
import { assertValid, isSlugValid, isUsernameValid, isUuidValid } from "../lib/validation.ts";
import { countCreators, findCreator, isAdmin, listAllCreators, listCreatorOverview, setSuspended, type OverviewSort } from "../db/creators.ts";
import { deletePost, findPost } from "../db/posts.ts";
import { deleteMedia, findMedia } from "../db/media.ts";
import { deleteSessionsByCreator } from "../db/sessions.ts";
import { avatarKey, imageKey, storage } from "../lib/storage.ts";
import { purgeCreator } from "../lib/purge.ts";
import { syncMediaFromStorage } from "../lib/media-sync.ts";
import { backupStatus, createBackup, deleteBackup, listBackups, readBackup, restoreBackup } from "../lib/backup.ts";
import { requireAdminAccount } from "../middleware/auth.ts";
import { invalidateCreator } from "../middleware/cache.ts";
import { logger } from "../lib/logger.ts";
import { listTeamMemberUsernames } from "../db/team.ts";
import type { AppState } from "../types.ts";

const PAGE_SIZE = 100;

const SORTS: OverviewSort[] = ["username", "posts", "storage", "created", "accessed"];

function readSort(value: string | null): OverviewSort {
	return SORTS.includes(value as OverviewSort) ? (value as OverviewSort) : "storage";
}

function readNumber(value: string | null, fallback: number, max: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.min(parsed, max);
}

/**
 * Loads the target of a moderation action.
 *
 * Refuses when the target is the acting admin, and when it is another admin.
 * Admins are removed by demoting them first, which keeps one compromised admin
 * session from quietly deleting the others.
 */
async function targetCreator(actor: string, username: string | undefined) {
	assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);

	const creator = await findCreator(username);
	if (!creator) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);

	if (creator.username === actor) throw new ApiError(ErrorCode.UNAUTHORIZED, "You cannot moderate your own account.");
	if (isAdmin(creator)) throw new ApiError(ErrorCode.UNAUTHORIZED, "Demote this administrator first.");

	return creator;
}

export function moderationRoutes(app: Web<AppState>): void {
	app.get("/api/v1/admin/creators", requireAdminAccount(), async (ctx) => {
		const params = new URL(ctx.req.url).searchParams;
		const sort = readSort(params.get("sort"));
		const descending = params.get("dir") !== "asc";
		const limit = readNumber(params.get("limit"), PAGE_SIZE, PAGE_SIZE);
		const offset = readNumber(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);
		const search = (params.get("q") ?? "").trim().slice(0, 320);

		const [overview, total] = await Promise.all([listCreatorOverview(sort, descending, limit, offset, search), countCreators(search)]);
		const baseStorage = Math.max(0, config.limits.maxAccountStorage);
		const creators = overview.map((creator) => ({
			...creator,
			storageLimit: config.limits.maxAccountStorage <= 0 ? 0 : Math.min(Number.MAX_SAFE_INTEGER, baseStorage + creator.additionalStorage),
		}));

		return ok(ctx, { creators, total, sort, dir: descending ? "desc" : "asc", limit, offset, search });
	});

	/**
	 * Suspending revokes every session and takes the blog off the public site
	 * immediately. Post rows are left alone, so lifting a suspension restores
	 * exactly what was published before rather than republishing drafts.
	 */
	app.post("/api/v1/admin/creators/:username/suspend", requireAdminAccount(), async (ctx) => {
		const actor = ctx.get("creator").username;
		const creator = await targetCreator(actor, ctx.params.username);

		await setSuspended(creator.username, true);
		await deleteSessionsByCreator(creator.username);
		for (const member of await listTeamMemberUsernames(creator.username)) await deleteSessionsByCreator(member);
		invalidateCreator(creator.username);

		logger.audit(`Creator suspended: ${creator.username}`, { username: creator.username, by: actor });
		return ok(ctx, { username: creator.username, suspended: true });
	});

	app.delete("/api/v1/admin/creators/:username/suspend", requireAdminAccount(), async (ctx) => {
		const actor = ctx.get("creator").username;
		const creator = await targetCreator(actor, ctx.params.username);

		await setSuspended(creator.username, false);
		invalidateCreator(creator.username);

		logger.audit(`Creator restored: ${creator.username}`, { username: creator.username, by: actor });
		return ok(ctx, { username: creator.username, suspended: false });
	});

	/**
	 * Reconciles one creator's media rows with the bucket and recomputes usage.
	 *
	 * Allowed on an admin's own account and on other admins, unlike the
	 * destructive actions: it only reads the bucket and corrects bookkeeping.
	 */
	app.post("/api/v1/admin/creators/:username/media/sync", requireAdminAccount(), async (ctx) => {
		const username = ctx.params.username;
		assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);

		const creator = await findCreator(username);
		if (!creator) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);

		return ok(ctx, await syncMediaFromStorage(creator.username));
	});

	/**
	 * The same, for every account. This is the one-press fix after pointing a
	 * fresh install at a bucket that already has media in it.
	 */
	app.post("/api/v1/admin/media/sync", requireAdminAccount(), async (ctx) => {
		const creators = await listAllCreators();

		let imported = 0;
		let pruned = 0;
		const skipped: string[] = [];

		for (const creator of creators) {
			const result = await syncMediaFromStorage(creator.username);
			imported += result.imported;
			pruned += result.pruned;
			skipped.push(...result.skipped);
		}

		logger.audit(`Media synced for every account`, { creators: creators.length, imported, pruned, by: ctx.get("creator").username });
		return ok(ctx, { creators: creators.length, imported, pruned, skipped });
	});

	app.get("/api/v1/admin/backups", requireAdminAccount(), async (ctx) => {
		const status = backupStatus();
		return ok(ctx, { ...status, backups: status.available ? await listBackups() : [] });
	});

	app.post("/api/v1/admin/backups", requireAdminAccount(), async (ctx) => {
		const entry = await createBackup();
		logger.audit(`Backup taken by ${ctx.get("creator").username}`, { name: entry.name });
		return ok(ctx, entry, 201);
	});

	app.get("/api/v1/admin/backups/:name", requireAdminAccount(), async (ctx) => {
		const name = ctx.params.name ?? "";
		const { stream, size } = await readBackup(name);

		return new Response(stream, {
			headers: {
				"Content-Type": "application/vnd.sqlite3",
				"Content-Length": String(size),
				"Content-Disposition": `attachment; filename="${name}"`,
				"Cache-Control": "no-store",
			},
		});
	});

	app.delete("/api/v1/admin/backups/:name", requireAdminAccount(), async (ctx) => {
		await deleteBackup(ctx.params.name ?? "");
		return ok(ctx);
	});

	/**
	 * Replaces the live database and stops the process for a supervisor to
	 * restart. The response goes out before the exit, so the panel can say what
	 * is about to happen rather than just losing the connection.
	 */
	app.post("/api/v1/admin/backups/:name/restore", requireAdminAccount(), async (ctx) => {
		const result = await restoreBackup(ctx.params.name ?? "");
		logger.audit(`Backup restored by ${ctx.get("creator").username}`, { ...result });
		return ok(ctx, result);
	});

	app.delete("/api/v1/admin/creators/:username", requireAdminAccount(), async (ctx) => {
		const actor = ctx.get("creator").username;
		const creator = await targetCreator(actor, ctx.params.username);

		await purgeCreator(creator.username, `admin:${actor}`);
		return ok(ctx);
	});

	app.delete("/api/v1/admin/creators/:username/posts/:slug", requireAdminAccount(), async (ctx) => {
		const actor = ctx.get("creator").username;
		const creator = await targetCreator(actor, ctx.params.username);

		const slug = ctx.params.slug ?? "";
		assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);

		const post = await findPost(creator.username, slug);
		if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		await deletePost(creator.username, slug);
		invalidateCreator(creator.username);

		logger.audit(`Post deleted: ${creator.username}/${slug}`, { username: creator.username, slug, by: actor });
		return ok(ctx);
	});

	/**
	 * The storage object goes first, matching {@link purgeCreator}: a failure
	 * there leaves an orphaned file rather than a row pointing at nothing.
	 */
	app.delete("/api/v1/admin/media/:id", requireAdminAccount(), async (ctx) => {
		const actor = ctx.get("creator").username;
		const id = ctx.params.id ?? "";
		assertValid(id, isUuidValid, ErrorCode.INVALID_IMAGE_NAME);

		const row = await findMedia(id);
		if (!row) throw new ApiError(ErrorCode.NOT_FOUND, "No such image.");

		const owner = await findCreator(row.username);
		if (owner && isAdmin(owner) && owner.username !== actor) throw new ApiError(ErrorCode.UNAUTHORIZED, "Demote this administrator first.");

		try {
			await storage.delete(row.kind === "avatar" ? avatarKey(row.username) : imageKey(row.username, row.id));
		} catch (err) {
			logger.warn(`Failed to delete media ${id} for ${row.username}`, { error: String(err) });
		}
		await deleteMedia(id);
		invalidateCreator(row.username);

		logger.audit(`Media deleted: ${row.username}/${id}`, { username: row.username, id, by: actor });
		return ok(ctx);
	});
}
