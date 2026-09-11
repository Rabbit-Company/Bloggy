import { connect, disconnect } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { countAdmins, findCreator, isAdmin, setAdmin } from "../db/creators.ts";
import { logger } from "./logger.ts";

export type AdminCommand = "promote" | "demote";

export function isAdminCommand(value: string | undefined): value is AdminCommand {
	return value === "promote" || value === "demote";
}

export async function runAdminCommand(command: AdminCommand, username: string | undefined): Promise<number> {
	if (username === undefined) {
		logger.error(`Usage: ${command} <username>`);
		return 1;
	}

	await connect();
	await migrate();

	try {
		const creator = await findCreator(username);
		if (creator === null) {
			logger.error(`No such creator: ${username}`);
			return 1;
		}

		const demoting = command === "demote";
		if (isAdmin(creator) === !demoting) {
			logger.info(`${username} is already ${demoting ? "not an admin" : "an admin"}. Nothing to do.`);
			return 0;
		}

		// Refuse to remove the last admin, which would leave the moderation
		// screens unreachable without another trip to the shell.
		if (demoting && (await countAdmins()) <= 1) {
			logger.error(`${username} is the only admin. Promote someone else first.`);
			return 1;
		}

		await setAdmin(username, !demoting);
		logger.audit(`${username} is ${demoting ? "no longer an admin" : "now an admin"}`, { username, command });
		return 0;
	} finally {
		await disconnect();
	}
}

export function readUsername(args: string[]): string | undefined {
	return args.find((arg) => !arg.startsWith("-"));
}
