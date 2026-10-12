import { Plugin } from 'obsidian';
import { normalizeSettings } from './settings';
import type { SemanticSearchSettings } from './settings';
import { IndexManager } from './index/indexManager';
import { registerCommands } from './commands';
import { SemanticSearchModal } from './ui/searchModal';
import { SemanticSearchSettingTab } from './ui/settingsTab';
import { describeStatus } from './ui/statusText';

export default class SemanticSearchPlugin extends Plugin {
	settings!: SemanticSearchSettings;
	index!: IndexManager;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.index = new IndexManager(this.app, () => this.settings, this.indexDatabaseName());

		registerCommands(this);
		this.addSettingTab(new SemanticSearchSettingTab(this.app, this));
		this.addRibbonIcon('search', 'Open semantic search', () => new SemanticSearchModal(this).open());
		this.addStatusBar();

		this.app.workspace.onLayoutReady(() => {
			// Registered after layout-ready so the vault's initial "create" events are skipped.
			this.registerEvent(this.app.vault.on('create', file => this.index.handleCreateOrModify(file)));
			this.registerEvent(this.app.vault.on('modify', file => this.index.handleCreateOrModify(file)));
			this.registerEvent(this.app.vault.on('delete', file => this.index.handleDelete(file)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.index.handleRename(file, oldPath)));
			void this.catchUp();
		});
	}

	onunload(): void {
		this.index.dispose();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.index.onSettingsChanged();
	}

	/** Index notes that changed while Obsidian was closed. Never triggers the first build. */
	private async catchUp(): Promise<void> {
		await this.index.load();
		if (this.settings.autoIndex && this.index.availability() !== 'empty') {
			await this.index.updateInBackground();
		}
	}

	private addStatusBar(): void {
		const el = this.addStatusBarItem();
		el.addClass('semantic-search-status-bar', 'is-hidden');
		this.registerEvent(this.index.onStatus(status => {
			const text = describeStatus(status);
			el.toggleClass('is-hidden', text === null);
			el.toggleClass('mod-error', status.state === 'error');
			el.setText(status.state === 'error' ? 'Semantic search: error' : `Semantic search: ${text ?? ''}`);
			el.setAttr('aria-label', text ?? '');
		}));
	}

	/** One IndexedDB database per vault, so each vault on this device has its own index. */
	private indexDatabaseName(): string {
		const appId = (this.app as unknown as { appId?: unknown }).appId;
		const vaultKey = typeof appId === 'string' && appId ? appId : this.app.vault.getName();
		return `${this.manifest.id}/index/${vaultKey}`;
	}
}
