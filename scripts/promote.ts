import { isAdminCommand, readUsername, runAdminCommand } from "../src/server/lib/admin-cli.ts";

const args = process.argv.slice(2);
const command = args.includes("--demote") ? "demote" : "promote";

if (!isAdminCommand(command)) process.exit(1);
process.exit(await runAdminCommand(command, readUsername(args)));
