/**
 * Grants or revokes the admin flag on an account.
 *
 * Run with shell access to the server, which is the right bar for handing out
 * moderation powers: `bun run promote <username>` / `bun run demote <username>`.
 */
import { connect, disconnect } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { countAdmins, findCreator, isAdmin, setAdmin } from "../src/server/db/creators.ts";
import { Logger } from "@rabbit-company/web-middleware/logger";

const logger = new Logger();
const demoting = process.argv.includes("--demote");
// The demote script passes --demote ahead of whatever the caller typed, so the
// username is the first argument that is not a flag rather than argv[2].
const username = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (username === undefined) {
	logger.error(`Usage: bun run ${demoting ? "demote" : "promote"} <username>`);
	process.exit(1);
}

await connect();
await migrate();

const creator = await findCreator(username);
if (creator === null) {
	logger.error(`No such creator: ${username}`);
	await disconnect();
	process.exit(1);
}

const already = isAdmin(creator);
if (already === !demoting) {
	logger.info(`${username} is already ${demoting ? "not an admin" : "an admin"}. Nothing to do.`);
	await disconnect();
	process.exit(0);
}

// Refuse to remove the last admin, which would leave the moderation screens
// unreachable without another trip to the shell.
if (demoting && (await countAdmins()) <= 1) {
	logger.error(`${username} is the only admin. Promote someone else first.`);
	await disconnect();
	process.exit(1);
}

await setAdmin(username, !demoting);
logger.info(`${username} is ${demoting ? "no longer an admin" : "now an admin"}.`);

await disconnect();
