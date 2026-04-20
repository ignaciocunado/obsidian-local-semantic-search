import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, SemanticSearchSettingTab } from './settings';
import type { SemanticSearchSettings } from './settings';
import { ChromaService } from './chromaService';
import { SemanticSearchModal } from './components/searchModal';
import { indexFile, indexVault, removeFile } from './search/indexer';

export default class SemanticSearchPlugin extends Plugin {
	settings!: SemanticSearchSettings;
	chroma!: ChromaService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.chroma = new ChromaService(this.settings);

		// ── Ribbon icon ────────────────────────────────────────────────────────
		this.addRibbonIcon('search', 'Semantic Search', () => {
			new SemanticSearchModal(this.app, this.chroma, this.settings).open();
		});

		// ── Commands ───────────────────────────────────────────────────────────
		this.addCommand({
			id: 'semantic-search-open',
			name: 'Open semantic search',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'o' }],
			callback: () => {
				new SemanticSearchModal(this.app, this.chroma, this.settings).open();
			},
		});

		this.addCommand({
			id: 'semantic-search-index-vault',
			name: 'Index entire vault',
			callback: async () => {
				try {
					await this.chroma.ensureCollection();
					await indexVault(this.app, this.chroma, this.settings);
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
			name: 'Clear index (delete collection)',
			callback: async () => {
				try {
					await this.chroma.deleteCollection();
					new Notice('Semantic Search: index cleared.');
				} catch (err) {
					new Notice(`Semantic Search: ${String(err)}`);
				}
			},
		});

		this.addCommand({
			id: 'semantic-search-show-count',
			name: 'Show indexed chunk count',
			callback: async () => {
				try {
					await this.chroma.ensureCollection();
					const count = await this.chroma.count();
					new Notice(`Semantic Search: ${count} chunk${count === 1 ? '' : 's'} indexed.`);
				} catch (err) {
					new Notice(`Semantic Search: ${String(err)}`);
				}
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
				try {
					await this.chroma.ensureCollection();
					await removeFile(file.path, this.chroma);
				} catch (err) {
					console.error('Semantic Search: failed to remove deleted file from index', err);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				try {
					await this.chroma.ensureCollection();
					await removeFile(oldPath, this.chroma);
					if (this.settings.autoIndexOnSave) {
						await indexFile(file, this.app, this.chroma, this.settings);
					}
				} catch (err) {
					console.error('Semantic Search: failed to handle rename in index', err);
				}
			})
		);

		// ── Settings tab ───────────────────────────────────────────────────────
		this.addSettingTab(new SemanticSearchSettingTab(this.app, this));
	}

	onunload(): void {
		// Nothing to clean up — ChromaService holds no persistent connections
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SemanticSearchSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Recreate the ChromaService in case the URL or collection name changed
		this.chroma = new ChromaService(this.settings);
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private async indexSingleFile(file: TFile): Promise<void> {
		try {
			await this.chroma.ensureCollection();
			await indexFile(file, this.app, this.chroma, this.settings);
			new Notice(`Semantic Search: indexed "${file.basename}"`, 2000);
		} catch (err) {
			new Notice(`Semantic Search: failed to index "${file.basename}" — ${String(err)}`);
			console.error('Semantic Search indexFile error:', err);
		}
	}
}
