import type { ChunkSpan } from './chunker';

/** Everything stored for one note. Vectors are unit length, `chunks.length * dimensions` floats. */
export interface FileRecord {
	path: string;
	mtime: number;
	/** Chunking configuration the note was split with (see `chunkingKey`). */
	chunkingKey: string;
	chunks: ChunkSpan[];
	vectors: Float32Array;
}

export interface SearchHit {
	path: string;
	/** Cosine similarity of the best-matching passage. */
	score: number;
	/** Best-matching passage in the note. */
	chunk: ChunkSpan;
}

/**
 * In-memory exact nearest-neighbour index. A brute-force scan over unit vectors
 * is a few milliseconds even for tens of thousands of passages, needs no index
 * structure to maintain, and makes updating a single note trivial.
 */
export class VectorIndex {
	private files = new Map<string, FileRecord>();

	constructor(public readonly dimensions: number) {}

	get fileCount(): number {
		return this.files.size;
	}

	get chunkCount(): number {
		let count = 0;
		for (const record of this.files.values()) count += record.chunks.length;
		return count;
	}

	get(path: string): FileRecord | undefined {
		return this.files.get(path);
	}

	paths(): IterableIterator<string> {
		return this.files.keys();
	}

	set(record: FileRecord): void {
		if (record.vectors.length !== record.chunks.length * this.dimensions) {
			throw new Error(`Vector size mismatch for ${record.path}`);
		}
		this.files.set(record.path, record);
	}

	delete(path: string): boolean {
		return this.files.delete(path);
	}

	clear(): void {
		this.files.clear();
	}

	/** Notes ranked by their best-matching passage, highest similarity first. */
	search(query: Float32Array, limit: number, excludePath?: string): SearchHit[] {
		const dims = this.dimensions;
		if (query.length !== dims) throw new Error('Query vector has the wrong dimensions');
		const hits: SearchHit[] = [];

		for (const record of this.files.values()) {
			if (record.path === excludePath) continue;
			const { vectors, chunks } = record;
			let bestScore = -Infinity;
			let bestIndex = -1;
			for (let c = 0; c < chunks.length; c++) {
				const offset = c * dims;
				let dot = 0;
				for (let d = 0; d < dims; d++) dot += (vectors[offset + d] ?? 0) * (query[d] ?? 0);
				if (dot > bestScore) {
					bestScore = dot;
					bestIndex = c;
				}
			}
			const chunk = chunks[bestIndex];
			if (chunk) hits.push({ path: record.path, score: bestScore, chunk });
		}

		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, Math.max(0, limit));
	}

	/** Unit-length mean of a note's passage vectors, used to find related notes. */
	noteVector(path: string): Float32Array | null {
		const record = this.files.get(path);
		if (!record || record.chunks.length === 0) return null;
		const dims = this.dimensions;
		const mean = new Float32Array(dims);
		for (let c = 0; c < record.chunks.length; c++) {
			for (let d = 0; d < dims; d++) mean[d] = (mean[d] ?? 0) + (record.vectors[c * dims + d] ?? 0);
		}
		let norm = 0;
		for (let d = 0; d < dims; d++) norm += (mean[d] ?? 0) ** 2;
		norm = Math.sqrt(norm);
		if (norm === 0) return null;
		for (let d = 0; d < dims; d++) mean[d] = (mean[d] ?? 0) / norm;
		return mean;
	}
}
