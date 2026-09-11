import { watch } from "node:fs";
import { buildPanel } from "./build.ts";

if (!(await buildPanel())) process.exit(1);

const server = Bun.spawn(["bun", "--watch", "run", "src/server/index.ts"], {
	stdio: ["inherit", "inherit", "inherit"],
	env: process.env,
});

let pending: ReturnType<typeof setTimeout> | undefined;

for (const directory of ["./src/panel", "./src/shared"]) {
	watch(directory, { recursive: true }, () => {
		clearTimeout(pending);
		pending = setTimeout(() => {
			void buildPanel(true).then((ok) => {
				if (ok) console.log(`[panel] rebuilt at ${new Date().toLocaleTimeString()}`);
			});
		}, 60);
	});
}

console.log("Watching src/panel and src/shared for changes…");

const stop = () => {
	server.kill();
	process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await server.exited;
