import { openDatabase, requestResult, transactionDone } from '../storage/idb';
import type { FileRecord } from './vectorIndex';

/** Describes which model the stored vectors came from. */
export interface IndexMeta {
	schema: number;
	modelKey: string;
	dimensions: number;
}

export const INDEX_SCHEMA = 1;

const META_STORE = 'meta';
const FILES_STORE = 'files';
const META_KEY = 'meta';

/**
 * Persists the index in IndexedDB, one record per note, so updating a note writes
 * a few kilobytes instead of the whole index. IndexedDB is local to this device:
 * every device builds its own index, and sync tools never see it.
 */
export class IndexStore {
	private db: Promise<IDBDatabase> | null = null;

	constructor(private readonly name: string) {}

	async load(): Promise<{ meta: IndexMeta | null; records: FileRecord[] }> {
		const db = await this.open();
		const tx = db.transaction([META_STORE, FILES_STORE]);
		const meta = await requestResult(tx.objectStore(META_STORE).get(META_KEY)) as IndexMeta | undefined;
		const records = await requestResult(tx.objectStore(FILES_STORE).getAll()) as FileRecord[];
		if (!meta || meta.schema !== INDEX_SCHEMA) return { meta: null, records: [] };
		return { meta, records };
	}

	/** Replace everything with an empty index for `meta`. */
	async reset(meta: IndexMeta | null): Promise<void> {
		const db = await this.open();
		const tx = db.transaction([META_STORE, FILES_STORE], 'readwrite');
		tx.objectStore(FILES_STORE).clear();
		if (meta) tx.objectStore(META_STORE).put(meta, META_KEY);
		else tx.objectStore(META_STORE).delete(META_KEY);
		await transactionDone(tx);
	}

	async put(record: FileRecord): Promise<void> {
		const db = await this.open();
		const tx = db.transaction(FILES_STORE, 'readwrite');
		tx.objectStore(FILES_STORE).put(record);
		await transactionDone(tx);
	}

	async delete(paths: string[]): Promise<void> {
		if (paths.length === 0) return;
		const db = await this.open();
		const tx = db.transaction(FILES_STORE, 'readwrite');
		const store = tx.objectStore(FILES_STORE);
		for (const path of paths) store.delete(path);
		await transactionDone(tx);
	}

	close(): void {
		void this.db?.then(db => db.close()).catch(() => undefined);
		this.db = null;
	}

	private open(): Promise<IDBDatabase> {
		this.db ??= openDatabase(this.name, 1, db => {
			db.createObjectStore(META_STORE);
			db.createObjectStore(FILES_STORE, { keyPath: 'path' });
		}).catch((err: unknown) => {
			this.db = null;
			throw err;
		});
		return this.db;
	}
}
