import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App, EventRef } from 'obsidian';
import type SemanticSearchPlugin from '../main';
import { MODEL_PRESETS, findPreset, modelDisplayName } from '../embedding/models';
import {
	CHUNK_OVERLAP_LIMITS,
	CHUNK_SIZE_LIMITS,
	MAX_RESULTS_LIMITS,
	parseFolderList,
} from '../settings';
import { describeStatus, downloadSizeText } from './statusText';
import { updateIndex } from '../commands';

const CUSTOM_MODEL = 'custom';

export class SemanticSearchSettingTab extends PluginSettingTab {
	private refs: EventRef[] = [];
	private showCustomModel = false;

	constructor(app: App, private readonly plugin: SemanticSearchPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.unsubscribe();

		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Notes are embedded and searched entirely on this device. The only network request is a '
				+ 'one-time download of the embedding model from huggingface.co when you first build the index.',
		});

		this.displayModelSettings(containerEl);
		this.displayIndexSettings(containerEl);
		this.displaySearchSettings(containerEl);
	}

	hide(): void {
		this.unsubscribe();
	}

	private displayModelSettings(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		const preset = findPreset(settings.modelId);
		const custom = this.showCustomModel || !preset;

		new Setting(containerEl).setName('Model').setHeading();

		new Setting(containerEl)
			.setName('Embedding model')
			.setDesc(custom
				? 'Any Hugging Face model with Transformers.js ONNX weights. Changing the model rebuilds the index.'
				: `${preset.description} Download ${downloadSizeText(preset.id)}. Changing the model rebuilds the index.`)
			.addDropdown(dropdown => {
				for (const p of MODEL_PRESETS) dropdown.addOption(p.id, p.name);
				dropdown.addOption(CUSTOM_MODEL, 'Custom model');
				dropdown.setValue(custom ? CUSTOM_MODEL : settings.modelId);
				dropdown.onChange(async value => {
					this.showCustomModel = value === CUSTOM_MODEL;
					if (value !== CUSTOM_MODEL) await this.updateSettings(s => (s.modelId = value));
					this.display();
				});
			});

		if (custom) {
			new Setting(containerEl)
				.setName('Custom model ID')
				.setDesc('A model ID from huggingface.co, applied when you press enter. Uses mean pooling and 8-bit weights.')
				.addText(text => {
					text.setPlaceholder('Owner/model-name').setValue(preset ? '' : settings.modelId);
					// Apply on blur or Enter rather than per keystroke, so partial ids are never downloaded.
					text.inputEl.addEventListener('change', () => {
						const id = text.getValue().trim();
						if (!/^[\w.-]+\/[\w.-]+$/.test(id)) {
							new Notice('Semantic search: enter a model ID in the form owner/model-name.');
							return;
						}
						if (id !== this.plugin.settings.modelId) void this.updateSettings(s => (s.modelId = id));
					});
				});
		}

		new Setting(containerEl)
			.setName('Delete index and models')
			.setDesc('Free the storage used on this device. Downloaded models are shared by all your vaults.')
			.addButton(button => button
				.setButtonText('Delete')
				.setWarning()
				.onClick(async () => {
					button.setDisabled(true);
					try {
						await this.plugin.index.deleteAllData();
						new Notice('Semantic search: deleted the index and downloaded models.');
					} catch (err) {
						new Notice(`Semantic search: ${err instanceof Error ? err.message : String(err)}`);
					}
					this.display();
				}));
	}

	private displayIndexSettings(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName('Index').setHeading();

		const status = new Setting(containerEl).setName('Status');
		const index = this.plugin.index;
		const renderStatus = () => {
			const availability = index.availability();
			const busy = describeStatus(index.status);
			const { notes, passages } = index.stats();
			let text: string;
			if (busy) text = busy;
			else if (availability === 'empty') text = 'Not built yet.';
			else if (availability === 'model-changed') text = 'Built with a different model. Rebuild to search again.';
			else text = `${notes.toLocaleString()} notes, ${passages.toLocaleString()} passages, using ${modelDisplayName(settings.modelId)}.`;
			status.setDesc(text);
		};
		status
			.addButton(button => button
				.setButtonText(index.availability() === 'ready' ? 'Update' : 'Build index')
				.setCta()
				.onClick(() => void updateIndex(this.plugin, false)))
			.addButton(button => button
				.setButtonText('Rebuild')
				.setTooltip('Discard the index and embed every note again')
				.onClick(() => void updateIndex(this.plugin, true)));
		renderStatus();
		this.refs.push(index.onStatus(renderStatus), index.on('changed', renderStatus));

		new Setting(containerEl)
			.setName('Index automatically')
			.setDesc('Once the index is built, keep it up to date as notes change, and catch up on changes at startup.')
			.addToggle(toggle => toggle
				.setValue(settings.autoIndex)
				.onChange(async value => {
					await this.updateSettings(s => (s.autoIndex = value));
				}));

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('One folder per line. Notes in these folders are not indexed.')
			.addTextArea(text => text
				.setPlaceholder('Templates')
				.setValue(settings.excludedFolders.join('\n'))
				.onChange(async value => {
					await this.updateSettings(s => (s.excludedFolders = parseFolderList(value)));
				}));

		new Setting(containerEl)
			.setName('Passage length')
			.setDesc('Maximum characters per indexed passage. Shorter passages give more precise matches. Changing this re-indexes every note.')
			.addSlider(slider => slider
				.setLimits(CHUNK_SIZE_LIMITS.min, CHUNK_SIZE_LIMITS.max, CHUNK_SIZE_LIMITS.step)
				.setValue(settings.chunkSize)
				.setDynamicTooltip()
				.onChange(async value => {
					await this.updateSettings(s => (s.chunkSize = value));
				}));

		new Setting(containerEl)
			.setName('Passage overlap')
			.setDesc('Characters of context repeated between consecutive passages. Changing this re-indexes every note.')
			.addSlider(slider => slider
				.setLimits(CHUNK_OVERLAP_LIMITS.min, CHUNK_OVERLAP_LIMITS.max, CHUNK_OVERLAP_LIMITS.step)
				.setValue(settings.chunkOverlap)
				.setDynamicTooltip()
				.onChange(async value => {
					await this.updateSettings(s => (s.chunkOverlap = value));
				}));
	}

	private displaySearchSettings(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName('Search').setHeading();

		new Setting(containerEl)
			.setName('Maximum results')
			.setDesc('Number of notes to show for each search.')
			.addSlider(slider => slider
				.setLimits(MAX_RESULTS_LIMITS.min, MAX_RESULTS_LIMITS.max, MAX_RESULTS_LIMITS.step)
				.setValue(settings.maxResults)
				.setDynamicTooltip()
				.onChange(async value => {
					await this.updateSettings(s => (s.maxResults = value));
				}));

		new Setting(containerEl)
			.setName('Show similarity scores')
			.setDesc('Show how closely each note matches the query.')
			.addToggle(toggle => toggle
				.setValue(settings.showScores)
				.onChange(async value => {
					await this.updateSettings(s => (s.showScores = value));
				}));
	}

	private async updateSettings(change: (settings: SemanticSearchPlugin['settings']) => void): Promise<void> {
		change(this.plugin.settings);
		await this.plugin.saveSettings();
	}

	private unsubscribe(): void {
		for (const ref of this.refs) this.plugin.index.offref(ref);
		this.refs = [];
	}
}
