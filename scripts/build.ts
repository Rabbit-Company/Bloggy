import { cp, mkdir, rm } from "node:fs/promises";

const panelOnly = process.argv.includes("--panel-only");
const watch = process.argv.includes("--watch");

const PANEL_OUT = "./public/panel";

export async function buildPanel(quiet = false): Promise<boolean> {
	await rm(PANEL_OUT, { recursive: true, force: true });
	await mkdir(PANEL_OUT, { recursive: true });

	const result = await Bun.build({
		entrypoints: ["./src/panel/main.ts"],
		outdir: PANEL_OUT,
		target: "browser",
		format: "esm",
		minify: !watch,
		sourcemap: watch ? "linked" : "none",
		publicPath: "/panel/",
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		return false;
	}

	await cp("./src/panel/index.html", `${PANEL_OUT}/index.html`);
	await cp("./src/panel/favicon.svg", `${PANEL_OUT}/favicon.svg`);
	await cp("./src/panel/assets", `${PANEL_OUT}/assets`, { recursive: true });

	if (!quiet) {
		const bytes = result.outputs.reduce((sum, output) => sum + output.size, 0);
		console.log(`Panel built: ${result.outputs.length} files, ${(bytes / 1024).toFixed(1)} kB → ${PANEL_OUT}`);
	}
	return true;
}

async function buildServer(): Promise<boolean> {
	await rm("./dist", { recursive: true, force: true });

	const build = Bun.spawnSync(["bun", "build", "--compile", "--minify", "--sourcemap", "--target=bun", "./src/server/index.ts", "--outfile", "./dist/bloggy"]);

	if (build.exitCode !== 0) {
		console.error(new TextDecoder().decode(build.stderr));
		return false;
	}

	console.log("Server built → dist/bloggy");
	return true;
}

if (import.meta.main) {
	if (!(await buildPanel())) process.exit(1);
	if (!panelOnly && !(await buildServer())) process.exit(1);
}
