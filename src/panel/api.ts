import { clearSession } from "./session.ts";
import { ErrorCode } from "../shared/errors.ts";
import type { PostStatus, PublicConfig } from "../shared/constants.ts";
export type { PostStatus };

export const API_URL = "";

export { ErrorCode };

export class ApiError extends Error {
	readonly code: number;
	readonly details: Record<string, unknown>;

	constructor(code: number, message: string, details: Record<string, unknown> = {}) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.details = details;
	}
}

interface Envelope<T> {
	error: number;
	info: string;
	data?: T;
}

/**
 * A 401 caused by an expired or revoked token clears the stored session, so
 * the router can send the user back to the login screen instead of looping on
 * failed requests.
 */
async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
	const headers = new Headers(init.headers);

	if (init.body !== undefined && !headers.has("Content-Type") && typeof init.body === "string") {
		headers.set("Content-Type", "application/json");
	}

	let response: Response;
	try {
		response = await fetch(API_URL + path, { ...init, headers, credentials: "same-origin" });
	} catch {
		throw new ApiError(-1, "Could not reach the server. Check your connection and try again.");
	}

	let body: Envelope<T>;
	try {
		body = (await response.json()) as Envelope<T>;
	} catch {
		throw new ApiError(-1, `Unexpected response from the server (HTTP ${response.status}).`);
	}

	if (body.error !== ErrorCode.SUCCESS) {
		if (body.error === ErrorCode.INVALID_TOKEN && auth) clearSession();
		const { error, info, data, ...details } = body as Envelope<T> & Record<string, unknown>;
		const message = typeof body.info === "string" && body.info.length > 0 ? body.info : `Request failed (HTTP ${response.status}).`;
		throw new ApiError(body.error, message, details);
	}

	return body.data as T;
}

const json = (value: unknown) => JSON.stringify(value);

export interface Creator {
	username: string;
	email: string;
	title: string;
	description: string;
	author: string;
	category: string;
	language: string;
	social: Record<string, string>;
	theme: string;
	twoFactorEnabled: boolean;
	isAdmin: boolean;
	suspendedAt: string | null;
	createdAt: string;
	accessedAt: string;
}

export interface Post {
	slug: string;
	title: string;
	description: string;
	picture: string;
	markdown: string;
	category: string;
	language: string;
	tag: string;
	keywords: string[];
	wordCount: number;
	readTime: number;
	status: PostStatus;
	createdAt: string;
	publishedAt: string | null;
	updatedAt: string;
}

export interface PostInput {
	slug: string;
	title: string;
	description: string;
	picture: string;
	markdown: string;
	category: string;
	language: string;
	tag: string;
	keywords: string;
	status: PostStatus;
}

export interface Session {
	id: string;
	ip: string | null;
	userAgent: string | null;
	createdAt: string;
	lastUsedAt: string;
	expiresAt: string;
	current: boolean;
}

export interface MediaItem {
	id: string;
	kind: string;
	contentType: string;
	size: number;
	createdAt: string;
	url: string;
}

export interface AnalyticsResult {
	view: string;
	title: string;
	unit: string;
	hours: number;
	from: string;
	to: string;
	bucketSeconds: number;
	hasData: boolean;
	maximum: number;
	stats: { label: string; value: number | null; unit: string }[];
	rows: { label: string; value: number; detail?: string }[];
	points: { timestamp: number; value: number | null; height: number }[];
}

export interface AdminCreator {
	username: string;
	author: string;
	title: string;
	email: string;
	createdAt: string;
	accessedAt: string;
	isAdmin: boolean;
	suspendedAt: string | null;
	posts: number;
	drafts: number;
	storage: number;
}

export interface Backup {
	key: string;
	name: string;
	size: number;
	createdAt: string;
}

export interface Settings {
	title: string;
	description: string;
	author: string;
	category: string;
	language: string;
	theme: string;
}

export const api = {
	config() {
		return request<PublicConfig>("/api/v1/config", {}, false);
	},

	register(input: Settings & { username: string; password: string; email: string }) {
		return request<{ username: string }>("/api/v1/auth/register", { method: "POST", body: json(input) }, false);
	},

	login(username: string, password: string, otp?: string) {
		return request<{ token: string; expiresAt: string; creator: Creator }>(
			"/api/v1/auth/login",
			{ method: "POST", body: json({ username, password, ...(otp ? { otp } : {}) }) },
			false,
		);
	},

	logout() {
		return request<void>("/api/v1/auth/logout", { method: "POST" });
	},

	me() {
		return request<{ creator: Creator; backupCodesRemaining: number }>("/api/v1/auth/me");
	},

	changePassword(currentPassword: string, newPassword: string) {
		return request<{ token: string; expiresAt: string }>("/api/v1/auth/password", {
			method: "POST",
			body: json({ currentPassword, newPassword }),
		});
	},

	sessions() {
		return request<{ sessions: Session[] }>("/api/v1/auth/sessions");
	},

	revokeSession(id: string) {
		return request<void>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
	},

	revokeOtherSessions() {
		return request<void>("/api/v1/auth/sessions", { method: "DELETE" });
	},

	beginTwoFactor() {
		return request<{ secret: string; uri: string; backupCodes: string[]; enrollment: string }>("/api/v1/auth/2fa/begin", {
			method: "POST",
		});
	},

	confirmTwoFactor(enrollment: string, code: string) {
		return request<{ backupCodes: string[] }>("/api/v1/auth/2fa/confirm", { method: "POST", body: json({ enrollment, code }) });
	},

	disableTwoFactor(password: string, otp: string) {
		return request<void>("/api/v1/auth/2fa/disable", { method: "POST", body: json({ password, otp }) });
	},

	regenerateBackupCodes(password: string, otp: string) {
		return request<{ backupCodes: string[] }>("/api/v1/auth/2fa/backup-codes", { method: "POST", body: json({ password, otp }) });
	},

	updateSettings(settings: Settings) {
		return request<Settings>("/api/v1/creators/me/settings", { method: "POST", body: json(settings) });
	},

	updateSocial(social: Record<string, string>) {
		return request<{ social: Record<string, string> }>("/api/v1/creators/me/social", { method: "POST", body: json({ social }) });
	},

	uploadAvatar(blob: Blob) {
		return request<{ url: string }>("/api/v1/creators/me/avatar", {
			method: "PUT",
			body: blob,
			headers: { "Content-Type": blob.type },
		});
	},

	adminCreators(sort: string, dir: string) {
		const query = new URLSearchParams({ sort, dir });
		return request<{ creators: AdminCreator[]; total: number }>(`/api/v1/admin/creators?${query}`);
	},

	adminSuspend(username: string, suspended: boolean) {
		return request<void>(`/api/v1/admin/creators/${encodeURIComponent(username)}/suspend`, { method: suspended ? "POST" : "DELETE" });
	},

	adminDeleteCreator(username: string) {
		return request<void>(`/api/v1/admin/creators/${encodeURIComponent(username)}`, { method: "DELETE" });
	},

	adminDeletePost(username: string, slug: string) {
		return request<void>(`/api/v1/admin/creators/${encodeURIComponent(username)}/posts/${encodeURIComponent(slug)}`, { method: "DELETE" });
	},

	adminSyncMedia(username: string) {
		return request<{ imported: number; pruned: number; skipped: string[]; usage: number }>(
			`/api/v1/admin/creators/${encodeURIComponent(username)}/media/sync`,
			{ method: "POST" },
		);
	},

	adminSyncAllMedia() {
		return request<{ creators: number; imported: number; pruned: number; skipped: string[] }>("/api/v1/admin/media/sync", { method: "POST" });
	},

	adminBackups() {
		return request<{ available: boolean; reason: string | null; enabled: boolean; intervalSeconds: number; keep: number; backups: Backup[] }>(
			"/api/v1/admin/backups",
		);
	},

	adminCreateBackup() {
		return request<Backup>("/api/v1/admin/backups", { method: "POST" });
	},

	adminDeleteBackup(name: string) {
		return request<void>(`/api/v1/admin/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
	},

	adminRestoreBackup(name: string) {
		return request<{ restored: string; previous: string }>(`/api/v1/admin/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
	},

	/** The download is a plain link, so the browser streams it straight to disk. */
	backupUrl(name: string) {
		return `/api/v1/admin/backups/${encodeURIComponent(name)}`;
	},

	adminDeleteImage(id: string) {
		return request<void>(`/api/v1/admin/media/${encodeURIComponent(id)}`, { method: "DELETE" });
	},

	deleteAccount(password: string, otp?: string) {
		return request<void>("/api/v1/creators/me", { method: "DELETE", body: json({ password, ...(otp ? { otp } : {}) }) });
	},

	/**
	 * `page` is a slug (or "home"), never a path: the server builds the path
	 * from the session, so this cannot address another creator's pages.
	 */
	analytics(view: string, hours: number, page?: string) {
		const query = `view=${encodeURIComponent(view)}&hours=${hours}${page === undefined ? "" : `&page=${encodeURIComponent(page)}`}`;
		return request<AnalyticsResult>(`/api/v1/analytics?${query}`);
	},

	analyticsPages() {
		return request<{ pages: { value: string; label: string }[] }>("/api/v1/analytics/pages");
	},

	async worldMap(): Promise<string> {
		const response = await fetch("/panel/assets/world.svg");
		if (!response.ok) throw new ApiError(-1, "The map could not be loaded.");
		return await response.text();
	},

	posts() {
		return request<{ posts: Post[] }>("/api/v1/posts");
	},

	post(slug: string) {
		return request<{ post: Post }>(`/api/v1/posts/${encodeURIComponent(slug)}`);
	},

	createPost(input: PostInput) {
		return request<{ slug: string; status: PostStatus }>("/api/v1/posts", { method: "POST", body: json(input) });
	},

	updatePost(input: PostInput) {
		return request<{ slug: string; status: PostStatus }>(`/api/v1/posts/${encodeURIComponent(input.slug)}`, { method: "PUT", body: json(input) });
	},

	deletePost(slug: string) {
		return request<void>(`/api/v1/posts/${encodeURIComponent(slug)}`, { method: "DELETE" });
	},

	preview(markdown: string) {
		return request<{ html: string; wordCount: number; readTime: number }>("/api/v1/preview", {
			method: "POST",
			body: json({ markdown }),
		});
	},

	media() {
		return request<{ usage: number; limit: number; images: MediaItem[] }>("/api/v1/media");
	},

	uploadImage(blob: Blob) {
		return request<MediaItem>("/api/v1/media", { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
	},

	deleteImage(id: string) {
		return request<void>(`/api/v1/media/${encodeURIComponent(id)}`, { method: "DELETE" });
	},
};
