import { config } from "../config.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import { mediaUsage } from "../db/media.ts";

export interface StorageQuota {
	used: number;
	/** The configured allowance, or 0 when storage is unlimited. */
	limit: number;
}

export function quotaDisabled(): boolean {
	return config.limits.maxAccountStorage <= 0;
}

export async function storageQuota(username: string): Promise<StorageQuota> {
	return { used: await mediaUsage(username), limit: Math.max(0, config.limits.maxAccountStorage) };
}

/**
 * `replacing` is the size of an object this upload overwrites. An avatar
 * replaces the previous one at the same key, so only the difference is new.
 * Pass 0 for an upload that adds a fresh object.
 *
 * Two uploads racing can both pass this check and put the account slightly over
 * its allowance. That is bounded by the per-file ceiling and self-corrects on
 * the next upload, which is a better trade than serializing every upload behind
 * a lock.
 */
export async function assertStorageAvailable(username: string, incoming: number, replacing = 0): Promise<void> {
	if (quotaDisabled()) return;

	const { used, limit } = await storageQuota(username);
	const projected = used - replacing + incoming;
	if (projected > limit) throw new ApiError(ErrorCode.STORAGE_QUOTA_EXCEEDED);
}
