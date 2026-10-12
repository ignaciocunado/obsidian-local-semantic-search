import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

// Bundle each tests/*.test.ts with esbuild and run it with Node's built-in test runner.
const testFiles = readdirSync("tests")
	.filter((file) => file.endsWith(".test.ts"))
	.map((file) => path.join("tests", file));

const outdir = mkdtempSync(path.join(tmpdir(), "semantic-search-tests-"));
try {
	await esbuild.build({
		entryPoints: testFiles,
		bundle: true,
		platform: "node",
		format: "esm",
		outdir,
		outExtension: { ".js": ".mjs" },
		logLevel: "warning",
	});
	const outputs = readdirSync(outdir).map((file) => path.join(outdir, file));
	const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit" });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
