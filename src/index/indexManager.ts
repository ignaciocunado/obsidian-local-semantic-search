import { Events, TFile, debounce } from 'obsidian';
import type { App, EventRef, TAbstractFile } from 'obsidian';
import { Embedder } from '../embedding/embedder';
import { modelKey, resolveModel } from '../embedding/models';
import type { ModelSpec } from '../embedding/models';
import { clearModelCache, isModelReady } from '../storage/modelCache';
import { isExcluded } from '../settings';
import type { SemanticSearchSettings } from '../settings';
import { chunkMarkdown, chunkingKey } from './chunker';
import { INDEX_SCHEMA, IndexStore } from './indexStore';
import type { IndexMeta } from './indexStore';
import { VectorIndex } from './vectorIndex';
import type { FileRecord, SearchHit } from './vectorIndex';

export type IndexStatus =
	| { state: 'idle' }
	| { state: 'loading-model'; downloading: boolean; loaded: number; total: number }
	| { state: 'indexing'; done: number; total: number }
	| { state: 'error'; message: string };

/** Whether the index can answer queries for the currently selected model. */
export type IndexAvailability = 'empty' | 'model-changed' | 'ready';

export interface NoteMatch extends SearchHit {
	file: TFile;
}

export interface UpdateSummary {
	indexed: number;
	removed: number;
	failed: number;
}

const EMBED_BATCH_SIZE = 16;
const MODIFY_DEBOUNCE_MS = 3000;

/**
 * Owns the vector index: loads it from IndexedDB, keeps it in sync with the vault,
 * and answers queries. Emits a `status` event whenever its status changes.
 */
export class IndexManager extends Events {
	private readonly embedder: Embedder;
	private readonly store: IndexStore;
	private vectors: VectorIndex | null = null;
	private meta: IndexMeta | null = null;
	private loaded: Promise<void> | null = null;
	private currentStatus: IndexStatus = { state: 'idle' };

	private readonly queue = new Set<string>();
	private running: Promise<{ indexed: number; failed: number }> | null = null;
	private readonly modified = new Set<string>();
	private readonly flushModified = debounce(() => this.enqueueModified(), MODIFY_DEBOUNCE_MS, true);
	private readonly settingsChanged = debounce(() => void this.updateInBackground(), 2000, true);

	constructor(
		private readonly app: App,
		private readonly getSettings: () => SemanticSearchSettings,
		storeName: string
	) {
		super();
		this.embedder = new Embedder(progress => {
			if (this.currentStatus.state === 'loading-model') {
				this.setStatus({ ...this.currentStatus, loaded: progress.loaded, total: progress.total });
			}
		});
		this.store = new IndexStore(storeName);
	}

	// ── State ─────────────────────────────────────────────────────────────────

	get status(): IndexStatus {
		return this.currentStatus;
	}

	onStatus(callback: (status: IndexStatus) => void): EventRef {
		return this.on('status', () => callback(this.currentStatus));
	}

	availability(): IndexAvailability {
		if (!this.meta || !this.vectors) return 'empty';
		if (this.meta.modelKey !== modelKey(this.model())) return 'model-changed';
		return 'ready';
	}

	stats(): { notes: number; passages: number } {
		return { notes: this.vectors?.fileCount ?? 0, passages: this.vectors?.chunkCount ?? 0 };
	}

	/** Load the persisted index. Safe to call repeatedly. */
	load(): Promise<void> {
		this.loaded ??= (async () => {
			try {
				const { meta, records } = await this.store.load();
				if (!meta) return;
				const vectors = new VectorIndex(meta.dimensions);
				for (const record of records) {
					try {
						vectors.set(record);
					} catch {
						// A malformed record is simply re-indexed on the next update.
					}
				}
				this.meta = meta;
				this.vectors = vectors;
			} catch (err) {
				console.error('Semantic search: failed to load the index', err);
			}
		})();
		return this.loaded;
	}

	// ── Indexing ──────────────────────────────────────────────────────────────

	/**
	 * Bring the index in line with the vault: embed new and changed notes and drop
	 * deleted or excluded ones. Builds the index from scratch if the model changed.
	 */
	async update(): Promise<UpdateSummary> {
		await this.load();
		if (this.currentStatus.state === 'error') this.setStatus({ state: 'idle' });
		const spec = this.model();

		// The model is only loaded when there is something to embed, so a no-op
		// update at startup costs a vault scan and nothing else.
		const needsNewIndex = () => !this.meta || !this.vectors || this.meta.modelKey !== modelKey(spec);
		if (needsNewIndex()) {
			let dimensions: number;
			try {
				dimensions = await this.ensureModel(spec);
			} catch (err) {
				this.setStatus({ state: 'error', message: describeModelError(err) });
				throw err;
			}
			// A concurrent update may have created the index while the model loaded.
			if (needsNewIndex()) {
				const meta = { schema: INDEX_SCHEMA, modelKey: modelKey(spec), dimensions };
				await this.store.reset(meta);
				this.meta = meta;
				this.vectors = new VectorIndex(dimensions);
				this.queue.clear();
				this.trigger('changed');
			}
		}
		const vectors = this.vectors;
		if (!vectors) return { indexed: 0, removed: 0, failed: 0 };

		const settings = this.getSettings();
		const currentChunking = chunkingKey(settings);
		const seen = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isExcluded(file.path, settings.excludedFolders)) continue;
			seen.add(file.path);
			const record = vectors.get(file.path);
			if (!record || record.mtime !== file.stat.mtime || record.chunkingKey !== currentChunking) {
				this.queue.add(file.path);
			}
		}
		const removed = [...vectors.paths()].filter(path => !seen.has(path));
		for (const path of removed) {
			vectors.delete(path);
			this.queue.delete(path);
		}
		await this.store.delete(removed);
		if (removed.length > 0) this.trigger('changed');

		const { indexed, failed } = await this.processQueue();
		if (this.currentStatus.state === 'error') throw new Error(this.currentStatus.message);
		return { indexed, removed: removed.length, failed };
	}

	/** Like `update()`, for callers that don't report the outcome. Failures are shown in the status. */
	async updateInBackground(): Promise<void> {
		try {
			await this.update();
		} catch (err) {
			console.error('Semantic search: background update failed', err);
		}
	}

	/** Discard the index and build it again. */
	async rebuild(): Promise<UpdateSummary> {
		await this.clear();
		return this.update();
	}

	/** Re-index a single note now. Requires a built index for the current model. */
	async indexFile(file: TFile): Promise<void> {
		if (this.availability() !== 'ready') throw new Error('Build the index first');
		this.queue.add(file.path);
		await this.processQueue();
		if (this.vectors?.get(file.path)?.mtime !== file.stat.mtime) {
			throw new Error(`Failed to index ${file.path}`);
		}
	}

	async clear(): Promise<void> {
		await this.load();
		this.queue.clear();
		this.modified.clear();
		this.meta = null;
		this.vectors = null;
		await this.store.reset(null);
		this.setStatus({ state: 'idle' });
		this.trigger('changed');
	}

	/** Delete the index and every downloaded model from this device. */
	async deleteAllData(): Promise<void> {
		// Clear first so a running indexing loop stops instead of restarting the worker.
		await this.clear();
		this.embedder.dispose();
		await clearModelCache();
	}

	/** Call after settings change; re-indexes in the background when needed. */
	onSettingsChanged(): void {
		if (this.meta && this.getSettings().autoIndex) this.settingsChanged();
	}

	// ── Vault events ──────────────────────────────────────────────────────────

	handleCreateOrModify(file: TAbstractFile): void {
		if (!this.shouldTrack(file)) return;
		this.modified.add(file.path);
		this.flushModified();
	}

	handleDelete(file: TAbstractFile): void {
		if (file instanceof TFile) this.removePath(file.path);
	}

	handleRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile) || !this.vectors) return;
		const record = this.vectors.get(oldPath);
		this.removePath(oldPath);
		if (record && file.extension === 'md' && !isExcluded(file.path, this.getSettings().excludedFolders)) {
			// Keep the note searchable under its new path; the title changed, so it is
			// re-embedded right away when auto-indexing is on, or on the next update.
			const moved: FileRecord = { ...record, path: file.path, mtime: -1 };
			this.vectors.set(moved);
			void this.store.put(moved).catch(err => console.error('Semantic search: failed to update the index', err));
		}
		this.handleCreateOrModify(file);
	}

	// ── Search ────────────────────────────────────────────────────────────────

	async search(query: string, limit: number): Promise<NoteMatch[]> {
		await this.load();
		const vectors = this.vectors;
		if (!vectors || this.availability() !== 'ready') return [];
		const spec = this.model();
		await this.ensureModel(spec);
		const [embedding] = await this.embedder.embed(spec, [query], 'query');
		if (!embedding || this.vectors !== vectors) return [];
		return this.resolve(vectors.search(embedding, limit));
	}

	/** Notes whose content is closest to `file` as a whole. */
	async similarTo(file: TFile, limit: number): Promise<NoteMatch[] | null> {
		await this.load();
		const vector = this.vectors?.noteVector(file.path);
		if (!this.vectors || !vector || this.availability() !== 'ready') return null;
		return this.resolve(this.vectors.search(vector, limit, file.path));
	}

	dispose(): void {
		this.flushModified.cancel();
		this.settingsChanged.cancel();
		this.queue.clear();
		this.embedder.dispose();
		this.store.close();
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	private model(): ModelSpec {
		return resolveModel(this.getSettings().modelId);
	}

	private setStatus(status: IndexStatus): void {
		this.currentStatus = status;
		this.trigger('status', status);
	}

	private removePath(path: string): void {
		this.queue.delete(path);
		this.modified.delete(path);
		if (this.vectors?.delete(path)) {
			void this.store.delete([path]).catch(err => console.error('Semantic search: failed to update the index', err));
			this.trigger('changed');
		}
	}

	private shouldTrack(file: TAbstractFile): file is TFile {
		const settings = this.getSettings();
		return file instanceof TFile
			&& file.extension === 'md'
			&& settings.autoIndex
			&& this.meta !== null
			&& !isExcluded(file.path, settings.excludedFolders);
	}

	private enqueueModified(): void {
		if (this.modified.size === 0 || this.availability() !== 'ready') return;
		for (const path of this.modified) this.queue.add(path);
		this.modified.clear();
		void this.processQueue().catch(err => console.error('Semantic search: background indexing failed', err));
	}

	private async ensureModel(spec: ModelSpec): Promise<number> {
		if (this.embedder.isLoaded(spec)) return this.embedder.load(spec);
		const previous = this.currentStatus;
		const downloading = !(await isModelReady(spec));
		this.setStatus({ state: 'loading-model', downloading, loaded: 0, total: 0 });
		try {
			return await this.embedder.load(spec);
		} finally {
			if (this.currentStatus.state === 'loading-model') {
				this.setStatus(previous.state === 'error' ? { state: 'idle' } : previous);
			}
		}
	}

	private processQueue(): Promise<{ indexed: number; failed: number }> {
		this.running ??= this.runQueue().finally(() => {
			this.running = null;
		});
		return this.running;
	}

	/**
	 * Embeds queued notes one at a time. Re-reads the index state on every iteration,
	 * so a clear, rebuild or model change made mid-run takes effect immediately.
	 */
	private async runQueue(): Promise<{ indexed: number; failed: number }> {
		let indexed = 0;
		let failed = 0;
		let done = 0;
		try {
			while (this.queue.size > 0) {
				const vectors = this.vectors;
				const spec = this.model();
				if (!vectors || this.meta?.modelKey !== modelKey(spec)) break;

				const path = this.queue.values().next().value as string;
				this.queue.delete(path);
				this.setStatus({ state: 'indexing', done, total: done + this.queue.size + 1 });

				try {
					await this.ensureModel(spec);
				} catch (err) {
					this.queue.add(path);
					this.setStatus({ state: 'error', message: describeModelError(err) });
					break;
				}
				try {
					if (await this.indexPath(path, spec, vectors)) indexed++;
				} catch (err) {
					failed++;
					console.error(`Semantic search: failed to index ${path}`, err);
				}
				done++;
			}
		} finally {
			if (this.currentStatus.state !== 'error') this.setStatus({ state: 'idle' });
			if (indexed > 0) this.trigger('changed');
		}
		return { indexed, failed };
	}

	/** Returns false when the note was skipped or the index was replaced meanwhile. */
	private async indexPath(path: string, spec: ModelSpec, vectors: VectorIndex): Promise<boolean> {
		const settings = this.getSettings();
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== 'md' || isExcluded(path, settings.excludedFolders)) {
			if (vectors.delete(path)) await this.store.delete([path]);
			return false;
		}

		// Read mtime first: an edit made while embedding leaves the record stale, not wrong.
		const mtime = file.stat.mtime;
		const currentChunking = chunkingKey(settings);
		const existing = vectors.get(path);
		if (existing && existing.mtime === mtime && existing.chunkingKey === currentChunking) return false;
		const content = await this.app.vault.cachedRead(file);
		const chunks = chunkMarkdown(content, file.basename, settings);
		const embedded = new Float32Array(chunks.length * vectors.dimensions);
		for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
			const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
			const result = await this.embedder.embed(spec, batch.map(c => c.text), 'passage');
			result.forEach((vector, j) => embedded.set(vector, (i + j) * vectors.dimensions));
		}
		if (this.vectors !== vectors) return false;

		const record: FileRecord = {
			path,
			mtime,
			chunkingKey: currentChunking,
			chunks: chunks.map(({ start, end, line, heading }) => ({ start, end, line, heading })),
			vectors: embedded,
		};
		vectors.set(record);
		await this.store.put(record);
		return true;
	}

	private resolve(hits: SearchHit[]): NoteMatch[] {
		const matches: NoteMatch[] = [];
		for (const hit of hits) {
			const file = this.app.vault.getAbstractFileByPath(hit.path);
			if (file instanceof TFile) matches.push({ ...hit, file });
		}
		return matches;
	}
}

function describeModelError(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	if (/fetch|network|Failed to load/i.test(message)) {
		return `Couldn't download the embedding model. Check your internet connection. (${message})`;
	}
	return `Couldn't load the embedding model: ${message}`;
}
