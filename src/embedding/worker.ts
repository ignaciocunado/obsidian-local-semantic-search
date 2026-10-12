/**
 * Embedding worker. Runs Transformers.js on ONNX Runtime's WebAssembly backend
 * off the main thread so indexing never freezes Obsidian.
 *
 * The ONNX Runtime WASM binary and its JS loader are bundled into this worker at
 * build time (see esbuild.config.mjs), so no code is ever fetched from a CDN.
 * The only network access is downloading model weights from the Hugging Face Hub
 * the first time a model is used; they are then cached in IndexedDB.
 */
import './workerEnv';
import { env, pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import ortGlueSource from 'virtual:ort-wasm-glue';
import ortWasmGzipBase64 from 'virtual:ort-wasm-binary';
import { markModelReady, modelFileCache } from '../storage/modelCache';
import { modelKey } from './models';
import type { ModelSpec } from './models';
import type { EmbedKind, WorkerRequest, WorkerResponse } from './protocol';

let runtimeReady: Promise<void> | null = null;
let extractor: FeatureExtractionPipeline | null = null;
let loadedSpec: ModelSpec | null = null;
let dimensions = 0;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(message, { transfer });
}

async function inflate(base64: string): Promise<Blob> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/wasm' });
}

async function initRuntime(): Promise<void> {
	const wasm = env.backends.onnx.wasm;
	if (!wasm) throw new Error('ONNX Runtime WebAssembly backend is unavailable');
	// Both files are served from blob URLs. `wasmBinary` can't be used instead: the
	// Emscripten loader would then resolve the binary's path relative to its own blob
	// URL, which is not a valid base URL.
	wasm.wasmPaths = {
		mjs: URL.createObjectURL(new Blob([ortGlueSource], { type: 'text/javascript' })),
		wasm: URL.createObjectURL(await inflate(ortWasmGzipBase64)),
	};
	// Multi-threading needs cross-origin isolation, which Obsidian does not enable.
	wasm.numThreads = 1;
	wasm.proxy = false;

	env.allowLocalModels = false;
	env.useBrowserCache = false;
	env.useCustomCache = true;
	env.customCache = modelFileCache;
}

async function load(spec: ModelSpec, remoteHost: string): Promise<number> {
	runtimeReady ??= initRuntime().catch((err: unknown) => {
		runtimeReady = null;
		throw err;
	});
	await runtimeReady;

	if (extractor && loadedSpec && modelKey(loadedSpec) === modelKey(spec)) return dimensions;
	if (extractor) {
		await extractor.dispose();
		extractor = null;
		loadedSpec = null;
	}

	env.remoteHost = remoteHost;
	const next = await pipeline('feature-extraction', spec.id, {
		dtype: spec.dtype,
		device: 'wasm',
		progress_callback: info => {
			if (info.status === 'progress') {
				post({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total });
			}
		},
	});
	const probe = await next('dimension probe', { pooling: spec.pooling, normalize: true });
	dimensions = probe.dims[probe.dims.length - 1] ?? 0;
	extractor = next;
	loadedSpec = spec;
	await markModelReady(spec);
	return dimensions;
}

async function embed(texts: string[], kind: EmbedKind): Promise<Float32Array> {
	if (!extractor || !loadedSpec) throw new Error('No embedding model is loaded');
	const prefix = kind === 'query' ? loadedSpec.queryPrefix : loadedSpec.passagePrefix;
	const output = await extractor(texts.map(t => prefix + t), {
		pooling: loadedSpec.pooling,
		normalize: true,
	});
	// Copy into a buffer we own so it can be transferred without cloning.
	return new Float32Array(output.data as Float32Array);
}

async function handle(request: WorkerRequest): Promise<void> {
	try {
		if (request.type === 'load') {
			const dims = await load(request.model, request.remoteHost);
			post({ id: request.id, type: 'loaded', dimensions: dims });
		} else {
			const vectors = await embed(request.texts, request.kind);
			post({ id: request.id, type: 'embedded', vectors, dimensions }, [vectors.buffer]);
		}
	} catch (err) {
		post({ id: request.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
	}
}

// Requests are handled strictly in order: a model swap never races an embedding call.
let queue: Promise<void> = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;
	queue = queue.then(() => handle(request));
});
