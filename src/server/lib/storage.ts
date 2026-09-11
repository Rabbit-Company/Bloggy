import { S3Client, type S3File } from "bun";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { config } from "../config.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import { logger } from "./logger.ts";

export interface StoredObject {
	key: string;
	size: number;
	uploadedAt: string;
}

export interface Storage {
	put(key: string, data: ArrayBuffer | Uint8Array | string, contentType: string): Promise<void>;
	get(key: string): Promise<{ stream: ReadableStream; size: number; contentType: string } | null>;
	delete(key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
	/** Every object under a prefix. Used to reconcile the media table with the bucket. */
	list(prefix: string): Promise<StoredObject[]>;
	/** Metadata for one object without opening its body. */
	stat(key: string): Promise<(StoredObject & { contentType: string }) | null>;
}

/**
 * Keys are built from validated usernames and UUIDs, so this is a second line
 * of defence rather than the only one, but path traversal is cheap to block
 * and expensive to miss.
 */
function assertSafeKey(key: string): void {
	if (key.length === 0 || key.includes("..") || key.includes("\0") || key.startsWith("/") || normalize(key) !== key) {
		throw new ApiError(ErrorCode.STORAGE_ERROR, "Invalid storage key.");
	}
}

class LocalStorage implements Storage {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	private path(key: string): string {
		assertSafeKey(key);
		const full = resolve(join(this.root, key));
		// resolve() collapses any traversal that slipped past assertSafeKey;
		// confirm the result is still inside the root before touching disk.
		if (!full.startsWith(`${this.root}/`)) {
			throw new ApiError(ErrorCode.STORAGE_ERROR, "Invalid storage key.");
		}
		return full;
	}

	async put(key: string, data: ArrayBuffer | Uint8Array | string, contentType: string): Promise<void> {
		const full = this.path(key);
		await mkdir(dirname(full), { recursive: true });
		await Bun.write(full, data);
		void contentType;
	}

	async get(key: string): Promise<{ stream: ReadableStream; size: number; contentType: string } | null> {
		const file = Bun.file(this.path(key));
		if (!(await file.exists())) return null;
		return { stream: file.stream(), size: file.size, contentType: file.type };
	}

	async delete(key: string): Promise<void> {
		try {
			await unlink(this.path(key));
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
		}
	}

	async exists(key: string): Promise<boolean> {
		return await Bun.file(this.path(key)).exists();
	}

	async list(prefix: string): Promise<StoredObject[]> {
		const root = this.path(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);

		let entries: string[];
		try {
			entries = await readdir(root);
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
			throw err;
		}

		const objects: StoredObject[] = [];
		for (const entry of entries) {
			const file = Bun.file(join(root, entry));
			if (!(await file.exists())) continue;
			const info = await stat(join(root, entry));
			if (!info.isFile()) continue;
			objects.push({
				key: `${prefix.replace(/\/$/, "")}/${entry}`,
				size: info.size,
				uploadedAt: new Date(info.mtimeMs).toISOString(),
			});
		}
		return objects;
	}

	async stat(key: string): Promise<(StoredObject & { contentType: string }) | null> {
		const file = Bun.file(this.path(key));
		if (!(await file.exists())) return null;
		const info = await stat(this.path(key));
		return { key, size: info.size, contentType: file.type, uploadedAt: new Date(info.mtimeMs).toISOString() };
	}
}

class S3Storage implements Storage {
	private readonly client: S3Client;

	constructor() {
		const { bucket, endpoint, region, accessKeyId, secretAccessKey } = config.storage.s3;
		if (bucket.length === 0 || accessKeyId.length === 0 || secretAccessKey.length === 0) {
			throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
		}

		this.client = new S3Client({
			bucket,
			accessKeyId,
			secretAccessKey,
			region,
			...(endpoint.length > 0 ? { endpoint } : {}),
		});
	}

	private file(key: string): S3File {
		assertSafeKey(key);
		return this.client.file(key);
	}

	async put(key: string, data: ArrayBuffer | Uint8Array | string, contentType: string): Promise<void> {
		await this.file(key).write(data, { type: contentType });
	}

	async get(key: string): Promise<{ stream: ReadableStream; size: number; contentType: string } | null> {
		const file = this.file(key);
		if (!(await file.exists())) return null;
		const stat = await file.stat();
		return { stream: file.stream(), size: stat.size, contentType: stat.type ?? "application/octet-stream" };
	}

	async delete(key: string): Promise<void> {
		await this.file(key).delete();
	}

	async exists(key: string): Promise<boolean> {
		return await this.file(key).exists();
	}

	/**
	 * A listing returns at most 1000 keys, so it is followed to the end. Content
	 * types are deliberately not fetched here: the listing does not carry them
	 * and a stat per object would turn one request into hundreds. Callers stat
	 * only the objects they actually need a type for.
	 */
	async list(prefix: string): Promise<StoredObject[]> {
		const objects: StoredObject[] = [];
		let continuationToken: string | undefined;

		do {
			const page = await this.client.list({ prefix, ...(continuationToken === undefined ? {} : { continuationToken }) });

			for (const entry of page.contents ?? []) {
				if (entry.key === undefined || entry.key.endsWith("/")) continue;
				objects.push({ key: entry.key, size: entry.size ?? 0, uploadedAt: entry.lastModified ?? new Date().toISOString() });
			}

			continuationToken = page.isTruncated === true ? page.nextContinuationToken : undefined;
		} while (continuationToken !== undefined);

		return objects;
	}

	async stat(key: string): Promise<(StoredObject & { contentType: string }) | null> {
		const file = this.file(key);
		if (!(await file.exists())) return null;
		const info = await file.stat();
		return {
			key,
			size: info.size,
			contentType: info.type !== undefined && info.type.length > 0 ? info.type : "application/octet-stream",
			uploadedAt: info.lastModified === undefined ? new Date().toISOString() : new Date(info.lastModified).toISOString(),
		};
	}
}

export const storage: Storage = config.storage.driver === "s3" ? new S3Storage() : new LocalStorage(config.storage.path);

logger.info(`Media storage driver: ${config.storage.driver}`);

export function avatarKey(username: string): string {
	return `avatars/${username}`;
}

export function imageKey(username: string, id: string): string {
	return `images/${username}/${id}`;
}

export function mediaUrl(key: string): string {
	return `${config.storage.cdnUrl}/${key}`;
}

export function avatarUrl(username: string): string {
	return mediaUrl(avatarKey(username));
}

export function pictureUrl(username: string, picture: string): string {
	if (picture.startsWith("http://") || picture.startsWith("https://")) return picture;
	return mediaUrl(imageKey(username, picture));
}
