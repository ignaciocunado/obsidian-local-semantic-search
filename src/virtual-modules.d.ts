// Modules generated at build time by esbuild.config.mjs.

/** Source code of the bundled embedding worker (src/embedding/worker.ts). */
declare module 'virtual:embedding-worker' {
	const source: string;
	export default source;
}

/** ONNX Runtime's Emscripten JS loader (ort-wasm-simd-threaded.mjs) as text. */
declare module 'virtual:ort-wasm-glue' {
	const source: string;
	export default source;
}

/** ONNX Runtime's WebAssembly binary, gzip-compressed and base64-encoded. */
declare module 'virtual:ort-wasm-binary' {
	const gzipBase64: string;
	export default gzipBase64;
}
