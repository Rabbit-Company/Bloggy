import { Web } from "@rabbit-company/web";
import { ApiError, ErrorCode } from "../lib/errors.ts";
import { jsonBody, ok, requireFields } from "../lib/response.ts";
import type { PostStatus } from "../../shared/constants.ts";
import {
	assertValid,
	isCategoryValid,
	isDraftMarkdownValid,
	isDraftTextValid,
	isDraftTitleValid,
	isPostStatusValid,
	isLanguageValid,
	isPostDescriptionValid,
	isPostKeywordsValid,
	isPostMarkdownValid,
	isPostPictureValid,
	isPostTagValid,
	isPostTitleValid,
	isSlugValid,
	isUsernameValid,
	readTime,
	wordCount,
} from "../lib/validation.ts";
import {
	deletePost,
	findPost,
	findPublishedPost,
	insertPost,
	listPostsByCreator,
	postExists,
	requestPostChanges,
	toPanelPost,
	toPublicPost,
	updatePost,
	type PostInput,
	type PostRow,
} from "../db/posts.ts";
import { findCreator, isEmailVerified, isSuspended } from "../db/creators.ts";
import { requireAuth } from "../middleware/auth.ts";
import { invalidateCreator, publicCache } from "../middleware/cache.ts";
import { pictureUrl } from "../lib/storage.ts";
import { renderMarkdown } from "../ssr/markdown.ts";
import { POST_MAX_MARKDOWN_BYTES } from "../lib/constants.ts";
import type { AppState, AuthActor } from "../types.ts";

function readStatus(body: Record<string, unknown>): PostStatus {
	if (body.status === undefined) return "published";
	assertValid(body.status, isPostStatusValid, ErrorCode.INVALID_POST_STATUS);
	return body.status;
}

function validatePost(body: Record<string, unknown>, slug: string, status: PostStatus): PostInput {
	assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);
	assertValid(body.category, isCategoryValid, ErrorCode.INVALID_CATEGORY);
	assertValid(body.language, isLanguageValid, ErrorCode.INVALID_LANGUAGE);

	if (status === "draft" || status === "changes") {
		assertValid(body.title, isDraftTitleValid, ErrorCode.INVALID_POST_TITLE);
		assertValid(body.description, isDraftTextValid(300), ErrorCode.INVALID_POST_DESCRIPTION);
		assertValid(body.picture, isDraftTextValid(500), ErrorCode.INVALID_POST_PICTURE);
		assertValid(body.tag, isDraftTextValid(30), ErrorCode.INVALID_POST_TAG);
		assertValid(body.keywords, isDraftTextValid(255), ErrorCode.INVALID_POST_KEYWORDS);
		assertValid(body.markdown, isDraftMarkdownValid, ErrorCode.INVALID_POST_MARKDOWN);
	} else {
		assertValid(body.title, isPostTitleValid, ErrorCode.INVALID_POST_TITLE);
		assertValid(body.description, isPostDescriptionValid, ErrorCode.INVALID_POST_DESCRIPTION);
		assertValid(body.picture, isPostPictureValid, ErrorCode.INVALID_POST_PICTURE);
		assertValid(body.markdown, isPostMarkdownValid, ErrorCode.INVALID_POST_MARKDOWN);
		assertValid(body.tag, isPostTagValid, ErrorCode.INVALID_POST_TAG);
		assertValid(body.keywords, isPostKeywordsValid, ErrorCode.INVALID_POST_KEYWORDS);
	}

	return {
		slug,
		title: body.title as string,
		description: body.description as string,
		picture: body.picture as string,
		markdown: body.markdown as string,
		category: body.category,
		language: body.language,
		tag: body.tag as string,
		keywords: body.keywords as string,
		status,
	};
}

const POST_FIELDS = ["category", "language"];

function canAccessPost(actor: AuthActor, post: PostRow): boolean {
	return actor.isOwner || actor.canEditAll || post.status === "published" || post.created_by === actor.username;
}

function canEditPost(actor: AuthActor, post: PostRow): boolean {
	if (actor.isOwner || actor.role === "publisher") return true;
	if (post.status === "published") return false;
	if (actor.role === "editor") return true;
	return post.created_by === actor.username;
}

function assertWritableStatus(actor: AuthActor, status: PostStatus, existing?: PostRow): void {
	if (status === "changes" && existing?.status !== "changes") throw new ApiError(ErrorCode.UNAUTHORIZED, "Only a reviewer can request changes.");
	if (status === "published" && !actor.canPublish) {
		throw new ApiError(ErrorCode.UNAUTHORIZED, "Your role cannot publish posts. Submit the post for review instead.");
	}
}

export function postRoutes(app: Web<AppState>): void {
	app.get("/api/v1/posts", requireAuth(), async (ctx) => {
		const actor = ctx.get("actor");
		const rows = await listPostsByCreator(ctx.get("creator").username);
		return ok(ctx, { posts: rows.filter((row) => canAccessPost(actor, row)).map(toPanelPost) });
	});

	app.post("/api/v1/posts", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["slug", ...POST_FIELDS]);

		const username = ctx.get("creator").username;
		const actor = ctx.get("actor");
		const status = readStatus(body);
		assertWritableStatus(actor, status);
		const input = validatePost(body, body.slug as string, status);

		if (await postExists(username, input.slug)) throw new ApiError(ErrorCode.POST_ID_TAKEN);

		const words = wordCount(input.markdown);
		await insertPost(username, input, words, readTime(words), actor.username);

		if (status === "published") invalidateCreator(username);

		return ok(ctx, { slug: input.slug, status }, 201);
	});

	app.get("/api/v1/posts/:slug", requireAuth(), async (ctx) => {
		const slug = ctx.params.slug ?? "";
		assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);

		const row = await findPost(ctx.get("creator").username, slug);
		if (!row) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		if (!canAccessPost(ctx.get("actor"), row)) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		return ok(ctx, { post: toPanelPost(row) });
	});

	app.put("/api/v1/posts/:slug", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, POST_FIELDS);

		const username = ctx.get("creator").username;
		const actor = ctx.get("actor");
		const status = readStatus(body);
		const input = validatePost(body, ctx.params.slug ?? "", status);

		const previous = await findPost(username, input.slug);
		if (previous === null) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		assertWritableStatus(actor, status, previous);
		if (!canEditPost(actor, previous)) throw new ApiError(ErrorCode.UNAUTHORIZED, "Your role cannot edit this post.");

		const words = wordCount(input.markdown);
		await updatePost(username, input, words, readTime(words), previous, actor.username);

		// Unpublishing has to purge just as publishing does, or the post stays
		// readable from cache after it was withdrawn.
		if (status === "published" || previous.status === "published") invalidateCreator(username);

		return ok(ctx, { slug: input.slug, status });
	});

	app.delete("/api/v1/posts/:slug", requireAuth(), async (ctx) => {
		const slug = ctx.params.slug ?? "";
		assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);

		const username = ctx.get("creator").username;
		const existing = await findPost(username, slug);
		if (existing === null) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		if (!canEditPost(ctx.get("actor"), existing)) throw new ApiError(ErrorCode.UNAUTHORIZED, "Your role cannot delete this post.");

		await deletePost(username, slug);
		if (existing.status === "published") invalidateCreator(username);

		return ok(ctx);
	});

	app.post("/api/v1/posts/:slug/request-changes", requireAuth(), async (ctx) => {
		const actor = ctx.get("actor");
		if (!actor.canPublish) throw new ApiError(ErrorCode.UNAUTHORIZED, "Your role cannot review posts.");
		const slug = ctx.params.slug ?? "";
		assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["note"]);
		if (typeof body.note !== "string" || body.note.trim().length < 1 || body.note.length > 500) {
			throw new ApiError(ErrorCode.MISSING_FIELDS, "A review note between 1 and 500 characters is required.");
		}

		const username = ctx.get("creator").username;
		const existing = await findPost(username, slug);
		if (existing === null) throw new ApiError(ErrorCode.POST_NOT_FOUND);
		if (existing.status !== "review") throw new ApiError(ErrorCode.INVALID_POST_STATUS, "Only a post in review can have changes requested.");
		await requestPostChanges(username, slug, body.note.trim(), actor.username);
		return ok(ctx, { slug, status: "changes" });
	});

	app.post("/api/v1/preview", requireAuth(), async (ctx) => {
		const body = await jsonBody<Record<string, unknown>>(ctx);
		requireFields(body, ["markdown"]);

		if (typeof body.markdown !== "string" || body.markdown.length > POST_MAX_MARKDOWN_BYTES) {
			throw new ApiError(ErrorCode.INVALID_POST_MARKDOWN);
		}

		const words = wordCount(body.markdown);
		return ok(ctx, {
			html: renderMarkdown(body.markdown),
			wordCount: words,
			readTime: readTime(words),
		});
	});

	app.get("/api/v1/creators/:username/posts/:slug", publicCache(), async (ctx) => {
		const username = ctx.params.username ?? "";
		const slug = ctx.params.slug ?? "";
		assertValid(username, isUsernameValid, ErrorCode.INVALID_USERNAME);
		assertValid(slug, isSlugValid, ErrorCode.INVALID_POST_ID);

		const [creator, row] = await Promise.all([findCreator(username), findPublishedPost(username, slug)]);
		if (!creator || isSuspended(creator) || !isEmailVerified(creator)) throw new ApiError(ErrorCode.CREATOR_NOT_FOUND);
		if (!row) throw new ApiError(ErrorCode.POST_NOT_FOUND);

		return ok(ctx, {
			post: { ...toPublicPost(row), picture: pictureUrl(username, row.picture) },
			creator: { username: creator.username, author: creator.author, title: creator.title },
		});
	});
}
