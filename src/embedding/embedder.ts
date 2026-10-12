import workerSource from 'virtual:embedding-worker';
import { modelKey } from './models';
import type { ModelSpec } from './models';
import type { EmbedKind, WorkerRequest, WorkerResponse } from './protocol';

export const MODEL_HOST = 'https://huggingface.co/';

export interface ModelLoadProgress {
	loaded: number;
	total: number;
}

type RequestBody =
	| { type: 'load'; model: ModelSpec; remoteHost: string }
	| { type: 'embed'; texts: string[]; kind: EmbedKind };

interface Pending {
	resolve: (response: WorkerResponse) => void;
	reject: (err: Error) => void;
}

/**
 * Plugin-side handle to the embedding worker. The worker is started lazily on
 * first use and keeps the loaded model in memory until `dispose()`.
 */
export class Embedder {
	private worker: Worker | null = null;
	private workerUrl: string | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private loaded: { key: string; dimensions: number } | null = null;
	private loading: { key: string; promise: Promise<number> } | null = null;
	private fileProgress = new Map<string, ModelLoadProgress>();

	constructor(private readonly onProgress: (progress: ModelLoadProgress) => void) {}

	isLoaded(spec: ModelSpec): boolean {
		return this.loaded?.key === modelKey(spec);
	}

	/** Load `spec` (downloading it on first use) and return its embedding dimensions. */
	async load(spec: ModelSpec): Promise<number> {
		const key = modelKey(spec);
		if (this.loaded?.key === key) return this.loaded.dimensions;
		if (this.loading?.key === key) return this.loading.promise;

		const promise = (async () => {
			this.fileProgress.clear();
			const response = await this.request({ type: 'load', model: spec, remoteHost: MODEL_HOST });
			if (response.type !== 'loaded') throw new Error('Unexpected response from embedding worker');
			this.loaded = { key, dimensions: response.dimensions };
			return response.dimensions;
		})();
		this.loaded = null;
		this.loading = { key, promise };
		try {
			return await promise;
		} finally {
			if (this.loading?.promise === promise) this.loading = null;
		}
	}

	/** Embed texts with the given model. Returns one unit-length vector per text. */
	async embed(spec: ModelSpec, texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
		if (texts.length === 0) return [];
		await this.load(spec);
		const response = await this.request({ type: 'embed', texts, kind });
		if (response.type !== 'embedded') throw new Error('Unexpected response from embedding worker');
		const { vectors, dimensions } = response;
		return texts.map((_, i) => vectors.subarray(i * dimensions, (i + 1) * dimensions));
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = null;
		this.loaded = null;
		this.loading = null;
		this.failPending(new Error('Embedding worker stopped'));
	}

	private request(body: RequestBody): Promise<WorkerResponse> {
		const worker = this.ensureWorker();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			worker.postMessage({ ...body, id } satisfies WorkerRequest);
		});
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		const worker = new Worker(this.workerUrl, { name: 'local-semantic-search-embedder' });
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
		worker.onerror = (event: ErrorEvent) => {
			event.preventDefault();
			console.error('Semantic search: embedding worker crashed', event.message);
			this.dispose();
		};
		this.worker = worker;
		return worker;
	}

	private handleMessage(message: WorkerResponse): void {
		if (message.type === 'progress') {
			this.fileProgress.set(message.file, { loaded: message.loaded, total: message.total });
			let loaded = 0;
			let total = 0;
			for (const p of this.fileProgress.values()) {
				loaded += p.loaded;
				total += p.total;
			}
			this.onProgress({ loaded, total });
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.type === 'error') pending.reject(new Error(message.message));
		else pending.resolve(message);
	}

	private failPending(err: Error): void {
		for (const { reject } of this.pending.values()) reject(err);
		this.pending.clear();
	}
}
