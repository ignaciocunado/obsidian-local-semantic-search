export type EmbeddingProvider = 'transformers' | 'ollama' | 'openai-compatible';

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
