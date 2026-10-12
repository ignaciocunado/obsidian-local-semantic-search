import { MarkdownView, Notice, TFile } from 'obsidian';
import type SemanticSearchPlugin from './main';
import { SemanticSearchModal } from './ui/searchModal';

export function registerCommands(plugin: SemanticSearchPlugin): void {
	plugin.addCommand({
		id: 'semantic-search-open',
		name: 'Open semantic search',
		callback: () => new SemanticSearchModal(plugin).open(),
	});

	plugin.addCommand({
		id: 'semantic-search-similar-notes',
		name: 'Find notes similar to the current note',
		checkCallback: (checking: boolean) => {
			const file = activeMarkdownFile(plugin);
			if (!file) return false;
			if (!checking) new SemanticSearchModal(plugin, file).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'semantic-search-index-vault',
		name: 'Update index',
		callback: () => void updateIndex(plugin, false),
	});

	plugin.addCommand({
		id: 'semantic-search-rebuild-index',
		name: 'Rebuild index',
		callback: () => void updateIndex(plugin, true),
	});

	plugin.addCommand({
		id: 'semantic-search-index-current',
		name: 'Re-index current note',
		checkCallback: (checking: boolean) => {
			const file = activeMarkdownFile(plugin);
			if (!file || plugin.index.availability() !== 'ready') return false;
			if (!checking) void indexCurrentNote(plugin, file);
			return true;
		},
	});

	plugin.addCommand({
		id: 'semantic-search-clear-index',
		name: 'Delete index',
		callback: async () => {
			await plugin.index.clear();
			new Notice('Semantic search: index deleted.');
		},
	});
}

/** Run an index update for an explicit user action and report the outcome. */
export async function updateIndex(plugin: SemanticSearchPlugin, rebuild: boolean): Promise<void> {
	new Notice(rebuild ? 'Semantic search: rebuilding the index…' : 'Semantic search: updating the index…', 3000);
	try {
		const { indexed, removed, failed } = rebuild ? await plugin.index.rebuild() : await plugin.index.update();
		const parts: string[] = [];
		if (indexed > 0) parts.push(`indexed ${plural(indexed, 'note')}`);
		if (removed > 0) parts.push(`removed ${plural(removed, 'note')}`);
		if (failed > 0) parts.push(`${failed} failed (see the developer console)`);
		new Notice(`Semantic search: ${parts.length > 0 ? parts.join(', ') : 'the index is up to date'}.`);
	} catch (err) {
		console.error('Semantic search: indexing failed', err);
		new Notice(`Semantic search: ${err instanceof Error ? err.message : String(err)}`, 8000);
	}
}

async function indexCurrentNote(plugin: SemanticSearchPlugin, file: TFile): Promise<void> {
	try {
		await plugin.index.indexFile(file);
		new Notice(`Semantic search: indexed "${file.basename}".`, 2000);
	} catch (err) {
		console.error('Semantic search: indexing failed', err);
		new Notice(`Semantic search: couldn't index "${file.basename}".`);
	}
}

function activeMarkdownFile(plugin: SemanticSearchPlugin): TFile | null {
	const file = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? plugin.app.workspace.getActiveFile();
	return file instanceof TFile && file.extension === 'md' ? file : null;
}

function plural(count: number, noun: string): string {
	return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}
