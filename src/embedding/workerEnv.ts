/**
 * Obsidian's desktop app enables Node.js integration inside web workers. Both
 * Transformers.js and ONNX Runtime check for `process` and would then try their
 * Node.js backends, which are not bundled. Hiding `process` makes them use the
 * WebAssembly backend instead. Imported first by the worker so this runs before
 * either library is evaluated.
 */
const scope = globalThis as { process?: unknown };
if (typeof scope.process !== 'undefined') {
	try {
		delete scope.process;
	} catch {
		// Non-configurable; overwrite below instead.
	}
	if (typeof scope.process !== 'undefined') scope.process = undefined;
}

export {};
