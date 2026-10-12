import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

/**
 * Transformers.js imports `onnxruntime-web`, whose default build includes the
 * WebGPU/JSEP backend (a ~22 MB WebAssembly binary) and fetches its runtime files
 * from a CDN. This plugin swaps in the WebAssembly-only build and exposes its
 * loader and binary as virtual modules, so the worker ships everything it runs.
 */
const onnxRuntimeWasmPlugin = {
	name: "onnxruntime-wasm",
	setup(build) {
		// Resolve through Transformers.js so we use the exact onnxruntime-web copy it depends on.
		let wasmEntry;
		const resolveWasmEntry = () => {
			wasmEntry ??= (async () => {
				const transformers = await build.resolve("@huggingface/transformers", {
					kind: "import-statement",
					resolveDir: process.cwd(),
				});
				const ort = await build.resolve("onnxruntime-web/wasm", {
					kind: "import-statement",
					resolveDir: path.dirname(transformers.path),
				});
				const errors = [...transformers.errors, ...ort.errors];
				if (errors.length > 0) throw new Error(errors.map((e) => e.text).join("\n"));
				return ort.path;
			})();
			return wasmEntry;
		};

		build.onResolve({ filter: /^onnxruntime-web$/ }, async () => ({ path: await resolveWasmEntry() }));

		build.onResolve({ filter: /^virtual:ort-wasm-(glue|binary)$/ }, (args) => ({
			path: args.path,
			namespace: "ort-asset",
		}));

		build.onLoad({ filter: /.*/, namespace: "ort-asset" }, async (args) => {
			const distDir = path.dirname(await resolveWasmEntry());
			if (args.path === "virtual:ort-wasm-glue") {
				const file = path.join(distDir, "ort-wasm-simd-threaded.mjs");
				return { contents: await readFile(file, "utf8"), loader: "text", watchFiles: [file] };
			}
			const file = path.join(distDir, "ort-wasm-simd-threaded.wasm");
			return {
				contents: gzipSync(await readFile(file), { level: 9 }),
				loader: "base64",
				watchFiles: [file],
			};
		});
	},
};

/** Bundle the embedding worker and return its source code plus the files it was built from. */
export async function buildWorker({ minify }) {
	const result = await esbuild.build({
		entryPoints: ["src/embedding/worker.ts"],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2020",
		// Pick onnxruntime-web's build that loads its WebAssembly loader from a URL we provide.
		conditions: ["onnxruntime-web-use-extern-wasm"],
		minify,
		metafile: true,
		logLevel: "warning",
		// ONNX Runtime probes `import.meta.url`; we pass every path explicitly instead.
		logOverride: { "empty-import-meta": "silent" },
		plugins: [onnxRuntimeWasmPlugin],
	});
	const watchFiles = Object.keys(result.metafile.inputs)
		.filter((input) => !input.includes(":"))
		.map((input) => path.resolve(input));
	return { code: result.outputFiles[0].text, watchFiles };
}

/** Lets the plugin import the worker's bundled source via `virtual:embedding-worker`. */
export function inlineWorkerPlugin({ minify }) {
	return {
		name: "inline-worker",
		setup(build) {
			build.onResolve({ filter: /^virtual:embedding-worker$/ }, (args) => ({
				path: args.path,
				namespace: "inline-worker",
			}));
			build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async () => {
				const { code, watchFiles } = await buildWorker({ minify });
				return { contents: code, loader: "text", watchFiles };
			});
		},
	};
}
