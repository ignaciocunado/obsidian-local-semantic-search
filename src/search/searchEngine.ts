import { LocalIndex, LocalFileStorage } from 'vectra';
import { getEmbeddings } from './embeddingUtils';

interface ChunkMetadata extends Record<string, string | number> {
	text: string;
	filePath: string;
	title: string;
	chunkIndex: number;
}

export interface UpsertItem {
	id: string;
	embedding: number[];
	text: string;
	filePath: string;
	title: string;
	chunkIndex: number;
}

export interface QueryResult {
	id: string;
	filePath: string;
	title: string;
	text: string;
	score: number;
	chunkIndex: number;
}

export class VectorStore {
	private index: LocalIndex<ChunkMetadata>;

	constructor(folderPath: string) {
		this.index = new LocalIndex<ChunkMetadata>(folderPath, 'index');
	}

	async initialize(): Promise<void> {
		if (!await this.index.isIndexCreated()) {
			await this.index.createIndex({ version: 1, metadata_config: { indexed: ['filePath'] } });
		}
	}

	async upsert(items: UpsertItem[]): Promise<void> {
		for (const item of items) {
			await this.index.upsertItem({
				id: item.id,
				vector: item.embedding,
				metadata: {
					text: item.text,
					filePath: item.filePath,
					title: item.title,
					chunkIndex: item.chunkIndex,
				},
			});
		}
	}

	async deleteByFilePath(filePath: string): Promise<void> {
		const items = await this.index.listItemsByMetadata({ filePath: { $eq: filePath } });
		for (const item of items) {
			await this.index.deleteItem(item.id);
		}
	}

	async query(embedding: number[], nResults: number): Promise<QueryResult[]> {
		const results = await this.index.queryItems(embedding, '', nResults);
		return results.map(r => ({
			id: r.item.id,
			filePath: r.item.metadata.filePath,
			title: r.item.metadata.title,
			text: r.item.metadata.text,
			score: r.score,
			chunkIndex: r.item.metadata.chunkIndex,
		}));
	}

	async clear(): Promise<void> {
		await this.index.deleteIndex();
		await this.index.createIndex({ version: 1, metadata_config: { indexed: ['filePath'] } });
	}

	async count(): Promise<number> {
		const items = await this.index.listItems();
		return items.length;
	}
}
