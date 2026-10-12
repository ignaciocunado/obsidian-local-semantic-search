import { openDatabase, requestResult, transactionDone } from './idb';
import { modelKey, type ModelSpec } from '../embedding/models';

/**
 * Downloaded model files live in IndexedDB rather than in the vault, so they are
 * shared by every vault on this device and never picked up by sync tools.
 * Used from both the plugin and the embedding worker.
 */
const DB_NAME = 'local-semantic-search-models';
const FILES_STORE = 'files';
const READY_STORE = 'ready';

let dbPromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
	dbPromise ??= openDatabase(DB_NAME, 1, db => {
		db.createObjectStore(FILES_STORE);
		db.createObjectStore(READY_STORE);
	}).catch((err: unknown) => {
		dbPromise = null;
		throw err;
	});
	return dbPromise;
}

/**
 * Implements the two Cache API methods Transformers.js uses (`match` and `put`).
 * Failures are logged and ignored so a broken cache never prevents embedding.
 */
export const modelFileCache = {
	async match(key: string): Promise<Response | undefined> {
		if (!/^https?:\/\//.test(key)) return undefined;
		try {
			const db = await database();
			const data = await requestResult(
				db.transaction(FILES_STORE).objectStore(FILES_STORE).get(key)
			) as ArrayBuffer | undefined;
			if (!data) return undefined;
			return new Response(data, { headers: { 'content-length': String(data.byteLength) } });
		} catch (err) {
			console.warn('Semantic search: model cache read failed', err);
			return undefined;
		}
	},

	async put(key: string, response: Response): Promise<void> {
		try {
			const data = await response.arrayBuffer();
			const db = await database();
			const tx = db.transaction(FILES_STORE, 'readwrite');
			tx.objectStore(FILES_STORE).put(data, key);
			await transactionDone(tx);
		} catch (err) {
			console.warn('Semantic search: model cache write failed', err);
		}
	},
};

/** Record that every file of a model has been downloaded and the model loaded successfully. */
export async function markModelReady(spec: ModelSpec): Promise<void> {
	const db = await database();
	const tx = db.transaction(READY_STORE, 'readwrite');
	tx.objectStore(READY_STORE).put(Date.now(), modelKey(spec));
	await transactionDone(tx);
}

export async function isModelReady(spec: ModelSpec): Promise<boolean> {
	try {
		const db = await database();
		const value = await requestResult(
			db.transaction(READY_STORE).objectStore(READY_STORE).get(modelKey(spec))
		) as unknown;
		return value !== undefined;
	} catch {
		return false;
	}
}

export async function clearModelCache(): Promise<void> {
	const db = await database();
	const tx = db.transaction([FILES_STORE, READY_STORE], 'readwrite');
	tx.objectStore(FILES_STORE).clear();
	tx.objectStore(READY_STORE).clear();
	await transactionDone(tx);
}
