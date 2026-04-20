import { FileSystemAdapter, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, SemanticSearchSettingTab } from './settings';
import type { SemanticSearchSettings } from './settings';
import { VectorStore } from './search/searchEngine';
import { SemanticSearchModal } from './components/searchModal';
import { indexFile, indexVault, removeFile } from './search/indexer';
import { env } from "@huggingface/transformers";

const INDEX_FOLDER = '.obsidian/plugins/local-semantic-search/vector-index';

export default class SemanticSearchPlugin extends Plugin {
	settings!: SemanticSearchSettings;
	store!: VectorStore;

	async onload(): Promise<void> {
		const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();

		await this.loadTransformersSettings(basePath);
		await this.loadSettings();

		this.store = new VectorStore(`${basePath}/${INDEX_FOLDER}`);
		await this.store.initialize();

		this.addRibbonIcon('search', 'Semantic Search', () => {
			new SemanticSearchModal(this.app, this.store, this.settings).open();
		});

		this.addCommand({
			id: 'semantic-search-open',
			name: 'Open semantic search',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'o' }],
			callback: () => {
				new SemanticSearchModal(this.app, this.store, this.settings).open();
			},
		});

		this.addCommand({
			id: 'semantic-search-index-vault',
			name: 'Index entire vault',
			callback: async () => {
				try {
					await indexVault(this.app, this.store, this.settings);
				} catch (err) {
					new Notice(`Semantic Search: ${String(err)}`);
					console.error('Semantic Search index-vault error:', err);
				}
			},
		});

		this.addCommand({
			id: 'semantic-search-index-current',
			name: 'Index current file',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) {
					void this.indexSingleFile(file);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'semantic-search-clear-index',
			name: 'Clear index',
			callback: async () => {
				await this.store.clear();
				new Notice('Semantic Search: index cleared.');
			},
		});

		this.addCommand({
			id: 'semantic-search-show-count',
			name: 'Show indexed chunk count',
			callback: async () => {
				const count = await this.store.count();
				new Notice(`Semantic Search: ${count} chunk${count === 1 ? '' : 's'} indexed.`);
			},
		});

		// ── Auto-index on save ─────────────────────────────────────────────────
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (!this.settings.autoIndexOnSave) return;
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				await this.indexSingleFile(file);
			})
		);

		// ── Keep index in sync with file renames / deletions ──────────────────
		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				await removeFile(file.path, this.store);
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				await removeFile(oldPath, this.store);
				if (this.settings.autoIndexOnSave) {
					await indexFile(file, this.app, this.store, this.settings);
				}
			})
		);

		this.addSettingTab(new SemanticSearchSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SemanticSearchSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private async indexSingleFile(file: TFile): Promise<void> {
		try {
			await indexFile(file, this.app, this.store, this.settings);
			new Notice(`Semantic Search: indexed "${file.basename}"`, 2000);
		} catch (err) {
			new Notice(`Semantic Search: failed to index "${file.basename}" — ${String(err)}`);
			console.error('Semantic Search indexFile error:', err);
		}
	}
	
	async loadTransformersSettings(basePath: string): Promise<void> {
		env.localModelPath = basePath + "/.model-cache/";
		env.allowRemoteModels = true;
		env.allowLocalModels = true;

		env.useBrowserCache = false;
	}
}
