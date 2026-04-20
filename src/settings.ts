import { App, PluginSettingTab, Setting } from 'obsidian';
import { EmbeddingProvider } from './types';
import type SemanticSearchPlugin from './main';

export interface SemanticSearchSettings {
	embeddingProvider: EmbeddingProvider;
	embeddingUrl: string;
	embeddingModel: string;
	apiKey: string;
	chunkSize: number;
	chunkOverlap: number;
	maxResults: number;
	autoIndexOnSave: boolean;
	excludedFolders: string;
}

export const DEFAULT_SETTINGS: SemanticSearchSettings = {
	embeddingProvider: 'transformers',
	embeddingUrl: 'http://localhost:11434',
	embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
	apiKey: '',
	chunkSize: 1000,
	chunkOverlap: 100,
	maxResults: 10,
	autoIndexOnSave: false,
	excludedFolders: '',
};

export class SemanticSearchSettingTab extends PluginSettingTab {
	plugin: SemanticSearchPlugin;

	constructor(app: App, plugin: SemanticSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Semantic Search Settings' });

		// --- Embeddings ---
		containerEl.createEl('h3', { text: 'Embeddings' });

		new Setting(containerEl)
			.setName('Embedding provider')
			.setDesc('How to generate embeddings.')
			.addDropdown(drop =>
				drop
					.addOption('transformers', 'Tramsformers JS (local, no API key required)')
					.setValue(this.plugin.settings.embeddingProvider)
					.onChange(async (value: string) => {
						this.plugin.settings.embeddingProvider = value as EmbeddingProvider;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName('Embedding server URL')
			.setDesc(
				this.plugin.settings.embeddingProvider === 'ollama'
					? 'Ollama base URL (e.g. http://localhost:11434)'
					: 'Base URL of the OpenAI-compatible server (e.g. http://localhost:1234)'
			)
			.addText(text =>
				text
					.setPlaceholder(
						this.plugin.settings.embeddingProvider === 'ollama'
							? 'http://localhost:11434'
							: 'http://localhost:1234'
					)
					.setValue(this.plugin.settings.embeddingUrl)
					.onChange(async value => {
						this.plugin.settings.embeddingUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Embedding model')
			.setDesc('Model name to use for embeddings (e.g. nomic-embed-text, mxbai-embed-large)')
			.addText(text =>
				text
					.setPlaceholder('nomic-embed-text')
					.setValue(this.plugin.settings.embeddingModel)
					.onChange(async value => {
						this.plugin.settings.embeddingModel = value.trim();
						await this.plugin.saveSettings();
					})
			);

		if (this.plugin.settings.embeddingProvider === 'openai-compatible') {
			new Setting(containerEl)
				.setName('API key')
				.setDesc('API key for the embedding server (leave empty if not required)')
				.addText(text =>
					text
						.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.apiKey)
						.onChange(async value => {
							this.plugin.settings.apiKey = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// --- Indexing ---
		containerEl.createEl('h3', { text: 'Indexing' });

		new Setting(containerEl)
			.setName('Chunk size')
			.setDesc('Maximum number of characters per text chunk')
			.addSlider(slider =>
				slider
					.setLimits(200, 4000, 100)
					.setValue(this.plugin.settings.chunkSize)
					.setDynamicTooltip()
					.onChange(async value => {
						this.plugin.settings.chunkSize = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Chunk overlap')
			.setDesc('Number of characters of overlap between consecutive chunks')
			.addSlider(slider =>
				slider
					.setLimits(0, 500, 50)
					.setValue(this.plugin.settings.chunkOverlap)
					.setDynamicTooltip()
					.onChange(async value => {
						this.plugin.settings.chunkOverlap = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folder paths to exclude from indexing (e.g. Templates,Attachments)')
			.addText(text =>
				text
					.setPlaceholder('Templates,Attachments')
					.setValue(this.plugin.settings.excludedFolders)
					.onChange(async value => {
						this.plugin.settings.excludedFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-index on save')
			.setDesc('Automatically re-index a note when it is saved')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.autoIndexOnSave)
					.onChange(async value => {
						this.plugin.settings.autoIndexOnSave = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Search ---
		containerEl.createEl('h3', { text: 'Search' });

		new Setting(containerEl)
			.setName('Max results')
			.setDesc('Maximum number of search results to display')
			.addSlider(slider =>
				slider
					.setLimits(3, 50, 1)
					.setValue(this.plugin.settings.maxResults)
					.setDynamicTooltip()
					.onChange(async value => {
						this.plugin.settings.maxResults = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
