/**
 * Minimal promise helpers around IndexedDB. Used from both the plugin and the
 * embedding worker, so this module must not import from `obsidian`.
 */

export function openDatabase(
	name: string,
	version: number,
	upgrade: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, version);
		request.onupgradeneeded = () => upgrade(request.result);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error(`Failed to open database ${name}`));
		request.onblocked = () => reject(new Error(`Database ${name} is blocked by another connection`));
	});
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
	});
}
