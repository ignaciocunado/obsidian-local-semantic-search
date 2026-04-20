import type { ChromaCollection, ChromaGetResponse, ChromaQueryResponse } from './types';
import type { SemanticSearchSettings } from './settings';

/**
 * Thin HTTP wrapper around the ChromaDB REST API (v0.4+).
 * No external dependencies — uses the global fetch available in Electron/Obsidian.
 */
export class ChromaService {
	private baseUrl: string;
	private collectionId: string | null = null;
	private collectionName: string;

	constructor(settings: SemanticSearchSettings) {
		this.baseUrl = settings.chromaUrl.replace(/\/$/, '');
		this.collectionName = settings.collectionName;
	}

	// ---------------------------------------------------------------------------
	// Collection management
	// ---------------------------------------------------------------------------

	async ensureCollection(): Promise<void> {
		// Try to get existing collection first
		try {
			const col = await this.getCollection(this.collectionName);
			this.collectionId = col.id;
			return;
		} catch {
			// Collection doesn't exist yet — create it
		}

		const col = await this.createCollection(this.collectionName);
		this.collectionId = col.id;
	}

	private async getCollection(name: string): Promise<ChromaCollection> {
		const res = await this.request('GET', `/api/v1/collections/${encodeURIComponent(name)}`);
		return res as ChromaCollection;
	}

	private async createCollection(name: string): Promise<ChromaCollection> {
		const res = await this.request('POST', '/api/v1/collections', {
			name,
			get_or_create: true,
		});
		return res as ChromaCollection;
	}

	async deleteCollection(): Promise<void> {
		await this.request('DELETE', `/api/v1/collections/${encodeURIComponent(this.collectionName)}`);
		this.collectionId = null;
	}

	// ---------------------------------------------------------------------------
	// Documents
	// ---------------------------------------------------------------------------

	/**
	 * Upsert chunks into the collection.
	 * Upserting means existing IDs are replaced, new IDs are added.
	 */
	async upsert(
		ids: string[],
		embeddings: number[][],
		documents: string[],
		metadatas: Record<string, string | number>[]
	): Promise<void> {
		const id = await this.requireCollectionId();
		await this.request('POST', `/api/v1/collections/${id}/upsert`, {
			ids,
			embeddings,
			documents,
			metadatas,
		});
	}

	/**
	 * Delete all chunks for a given file path using a metadata filter.
	 */
	async deleteByFilePath(filePath: string): Promise<void> {
		const id = await this.requireCollectionId();

		// First fetch all IDs for this file
		const existing = await this.getByFilePath(filePath);
		if (existing.ids.length === 0) return;

		await this.request('POST', `/api/v1/collections/${id}/delete`, {
			ids: existing.ids,
		});
	}

	/**
	 * Get all chunk IDs (and metadata) stored for a given file path.
	 */
	async getByFilePath(filePath: string): Promise<ChromaGetResponse> {
		const id = await this.requireCollectionId();
		const res = await this.request('POST', `/api/v1/collections/${id}/get`, {
			where: { filePath: { $eq: filePath } },
			include: ['metadatas'],
		});
		return res as ChromaGetResponse;
	}

	/**
	 * Query the collection with an embedding vector.
	 * Returns the closest `nResults` chunks.
	 */
	async query(
		queryEmbedding: number[],
		nResults: number
	): Promise<ChromaQueryResponse> {
		const id = await this.requireCollectionId();
		const res = await this.request('POST', `/api/v1/collections/${id}/query`, {
			query_embeddings: [queryEmbedding],
			n_results: nResults,
			include: ['metadatas', 'documents', 'distances'],
		});
		return res as ChromaQueryResponse;
	}

	/**
	 * Return the total number of embeddings stored in the collection.
	 */
	async count(): Promise<number> {
		const id = await this.requireCollectionId();
		const res = await this.request('GET', `/api/v1/collections/${id}/count`);
		return res as number;
	}

	// ---------------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------------

	private async requireCollectionId(): Promise<string> {
		if (!this.collectionId) {
			await this.ensureCollection();
		}
		if (!this.collectionId) {
			throw new Error('ChromaDB collection could not be created or fetched');
		}
		return this.collectionId;
	}

	private async request(
		method: string,
		path: string,
		body?: unknown
	): Promise<unknown> {
		const url = `${this.baseUrl}${path}`;
		const init: RequestInit = {
			method,
			headers: { 'Content-Type': 'application/json' },
		};
		if (body !== undefined) {
			init.body = JSON.stringify(body);
		}

		let res: Response;
		try {
			res = await fetch(url, init);
		} catch (err) {
			throw new Error(
				`Cannot reach ChromaDB at ${this.baseUrl}. Is the server running? (${String(err)})`
			);
		}

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`ChromaDB ${method} ${path} → ${res.status}: ${text}`);
		}

		const text = await res.text();
		if (!text) return null;
		return JSON.parse(text);
	}
}
