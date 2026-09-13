import { avatarKey, imageKey, storage } from "./storage.ts";
import { deleteCreator } from "../db/creators.ts";
import { deleteMediaByCreator, listMediaByCreator } from "../db/media.ts";
import { deletePostsByCreator } from "../db/posts.ts";
import { deleteSessionsByCreator } from "../db/sessions.ts";
import { invalidateCreator } from "../middleware/cache.ts";
import { logger } from "./logger.ts";
import { deleteTeamInvites, deleteTeamMembers, listTeamMemberUsernames } from "../db/team.ts";
import { deletePasswordResetTokens } from "../db/password-resets.ts";
import { deleteEmailConfirmationTokens } from "../db/email-confirmations.ts";
import { deleteCustomization } from "../db/customizations.ts";

/**
 * Deletes an account and everything attached to it.
 *
 * Shared by the creator's own delete endpoint and the admin one so the two
 * cannot drift. Order matters: stored objects go first, because a failure there
 * leaves orphaned files with their database rows intact, which is recoverable.
 * The reverse leaves files nothing points at.
 */
export async function purgeCreator(username: string, reason: string): Promise<void> {
	const media = await listMediaByCreator(username);
	for (const item of media) {
		try {
			await storage.delete(item.kind === "avatar" ? avatarKey(username) : imageKey(username, item.id));
		} catch (err) {
			logger.warn(`Failed to delete media ${item.id} for ${username}`, { error: String(err) });
		}
	}

	try {
		await storage.delete(avatarKey(username));
	} catch {
		// Already gone, which is fine: the account is being deleted anyway.
	}

	await deleteMediaByCreator(username);
	await deletePostsByCreator(username);
	const members = await listTeamMemberUsernames(username);
	for (const member of members) {
		await deleteSessionsByCreator(member);
		await deletePasswordResetTokens(member);
	}
	await deleteTeamInvites(username);
	await deleteTeamMembers(username);
	await deleteSessionsByCreator(username);
	await deletePasswordResetTokens(username);
	await deleteEmailConfirmationTokens(username);
	await deleteCustomization(username);
	await deleteCreator(username);

	invalidateCreator(username);
	logger.audit(`Creator deleted: ${username}`, { username, reason });
}
