export interface SearchResult {
	id: string;
	filePath: string;
	title: string;
	excerpt: string;
	score: number;
	chunkIndex: number;
}

export interface Chunk {
	id: string;
	text: string;
	filePath: string;
	title: string;
	chunkIndex: number;
}

export interface ChromaCollection {
	id: string;
	name: string;
}

export interface ChromaQueryResponse {
	ids: string[][];
	documents: (string | null)[][];
	metadatas: (Record<string, string | number> | null)[][];
	distances: number[][];
}

export interface ChromaGetResponse {
	ids: string[];
	documents: (string | null)[];
	metadatas: (Record<string, string | number> | null)[];
}

export type EmbeddingProvider = 'ollama' | 'openai-compatible';
