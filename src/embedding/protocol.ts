import type { ModelSpec } from './models';

export type EmbedKind = 'query' | 'passage';

/** Messages sent from the plugin to the embedding worker. */
export type WorkerRequest =
	| { id: number; type: 'load'; model: ModelSpec; remoteHost: string }
	| { id: number; type: 'embed'; texts: string[]; kind: EmbedKind };

/** Messages sent from the embedding worker back to the plugin. */
export type WorkerResponse =
	| { id: number; type: 'loaded'; dimensions: number }
	| { id: number; type: 'embedded'; vectors: Float32Array; dimensions: number }
	| { id: number; type: 'error'; message: string }
	| { type: 'progress'; file: string; loaded: number; total: number };
