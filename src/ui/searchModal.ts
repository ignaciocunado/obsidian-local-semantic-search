import { Keymap, MarkdownView, Modal, Notice, Platform, setIcon } from 'obsidian';
import type { EventRef, TFile } from 'obsidian';
import type SemanticSearchPlugin from '../main';
import type { NoteMatch } from '../index/indexManager';
import { describeStatus, downloadSizeText } from './statusText';
import { excerptFor, highlightTerms, renderHighlighted } from './excerpt';

const SEARCH_DEBOUNCE_MS = 250;

type OpenMode = 'current' | 'tab' | 'link';

/**
 * Quick-switcher style modal for semantic search. With `similarTo`, it opens
 * listing notes related to that note until the user types a query.
 */
export class SemanticSearchModal extends Modal {
	private inputEl!: HTMLInputElement;
	private spinnerEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private resultsEl!: HTMLElement;

	private matches: NoteMatch[] = [];
	private selected = 0;
	private searchTimer: number | null = null;
	private searchToken = 0;
	private renderToken = 0;
	private statusRef: EventRef | null = null;
	private changedRef: EventRef | null = null;

	constructor(private readonly plugin: SemanticSearchPlugin, private readonly similarTo?: TFile) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass('semantic-search-modal');
		this.contentEl.empty();

		const inputRow = this.contentEl.createDiv('semantic-search-input-row');
		setIcon(inputRow.createSpan('semantic-search-icon'), 'search');
		this.inputEl = inputRow.createEl('input', {
			type: 'text',
			cls: 'semantic-search-input',
			attr: {
				placeholder: this.similarTo
					? `Notes similar to "${this.similarTo.basename}", or type to search…`
					: 'Search notes by meaning…',
				spellcheck: 'false',
			},
		});
		this.spinnerEl = inputRow.createDiv('semantic-search-spinner');

		this.statusEl = this.contentEl.createDiv('semantic-search-status');
		this.resultsEl = this.contentEl.createDiv('semantic-search-results');
		this.renderInstructions();

		this.inputEl.addEventListener('input', () => this.onInput());
		this.registerKeys();
		this.statusRef = this.plugin.index.onStatus(() => this.renderStatus());
		this.changedRef = this.plugin.index.on('changed', () => this.refreshAfterIndexChange());

		this.renderStatus();
		void this.showDefaultResults();
		this.inputEl.focus();
	}

	onClose(): void {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
		this.searchToken++;
		if (this.statusRef) this.plugin.index.offref(this.statusRef);
		if (this.changedRef) this.plugin.index.offref(this.changedRef);
		this.contentEl.empty();
	}

	// ── Input ─────────────────────────────────────────────────────────────────

	private registerKeys(): void {
		const move = (delta: number) => (evt: KeyboardEvent) => {
			evt.preventDefault();
			this.select(this.selected + delta);
			return false;
		};
		const open = (mode: OpenMode) => (evt: KeyboardEvent) => {
			if (evt.isComposing) return true;
			evt.preventDefault();
			const match = this.matches[this.selected];
			if (match) void this.openMatch(match, mode);
			return false;
		};
		this.scope.register([], 'ArrowDown', move(1));
		this.scope.register([], 'ArrowUp', move(-1));
		this.scope.register(['Ctrl'], 'n', move(1));
		this.scope.register(['Ctrl'], 'p', move(-1));
		this.scope.register([], 'Enter', open('current'));
		this.scope.register(['Mod'], 'Enter', open('tab'));
		this.scope.register(['Alt'], 'Enter', open('link'));
	}

	private onInput(): void {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
		const query = this.inputEl.value.trim();
		if (!query) {
			this.searchToken++;
			this.setLoading(false);
			void this.showDefaultResults();
			return;
		}
		this.searchTimer = window.setTimeout(() => void this.runSearch(query), SEARCH_DEBOUNCE_MS);
	}

	// ── Searching ─────────────────────────────────────────────────────────────

	private async runSearch(query: string): Promise<void> {
		const token = ++this.searchToken;
		if (this.plugin.index.availability() !== 'ready') {
			await this.renderMatches([], query);
			return;
		}
		this.setLoading(true);
		try {
			const matches = await this.plugin.index.search(query, this.plugin.settings.maxResults);
			if (token !== this.searchToken) return;
			await this.renderMatches(matches, query);
		} catch (err) {
			if (token !== this.searchToken) return;
			console.error('Semantic search: query failed', err);
			this.renderMessage(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (token === this.searchToken) this.setLoading(false);
		}
	}

	private async showDefaultResults(): Promise<void> {
		const token = ++this.searchToken;
		if (!this.similarTo) {
			await this.renderMatches([], '');
			return;
		}
		const matches = await this.plugin.index.similarTo(this.similarTo, this.plugin.settings.maxResults);
		if (token !== this.searchToken) return;
		if (matches === null) {
			await this.renderMatches([], '');
			if (this.plugin.index.availability() === 'ready') {
				this.renderMessage(`"${this.similarTo.basename}" hasn't been indexed yet.`);
			}
			return;
		}
		await this.renderMatches(matches, '');
	}

	private refreshAfterIndexChange(): void {
		const query = this.inputEl.value.trim();
		if (query) void this.runSearch(query);
		else void this.showDefaultResults();
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private setLoading(loading: boolean): void {
		this.spinnerEl.toggleClass('is-active', loading);
	}

	private renderStatus(): void {
		const index = this.plugin.index;
		const availability = index.availability();
		const busy = describeStatus(index.status);
		this.statusEl.empty();

		if (busy) {
			this.statusEl.createSpan({ text: busy });
			if (index.status.state === 'indexing' && availability === 'ready') {
				this.statusEl.createSpan({ text: ' Results may be incomplete.' });
			}
			if (index.status.state === 'error') this.addStatusButton('Retry', () => index.update());
		} else if (availability === 'empty') {
			this.statusEl.createSpan({
				text: `Your notes haven't been indexed yet. Indexing downloads a small embedding model `
					+ `(${downloadSizeText(this.plugin.settings.modelId)}) once; after that everything runs on this device.`,
			});
			this.addStatusButton('Build index', () => index.update());
		} else if (availability === 'model-changed') {
			this.statusEl.createSpan({ text: 'The embedding model changed, so the index needs to be rebuilt.' });
			this.addStatusButton('Rebuild index', () => index.update());
		}
		this.statusEl.toggleClass('is-hidden', this.statusEl.childElementCount === 0);
	}

	private addStatusButton(label: string, action: () => Promise<unknown>): void {
		const button = this.statusEl.createEl('button', { text: label, cls: 'mod-cta' });
		button.addEventListener('click', () => {
			button.disabled = true;
			action()
				.catch(err => console.error('Semantic search: indexing failed', err))
				.finally(() => this.inputEl.focus());
		});
	}

	private renderMessage(text: string): void {
		this.renderToken++;
		this.matches = [];
		this.resultsEl.empty();
		this.resultsEl.createDiv({ cls: 'semantic-search-empty', text });
	}

	private async renderMatches(matches: NoteMatch[], query: string): Promise<void> {
		const token = ++this.renderToken;
		const contents = await Promise.all(matches.map(m => this.app.vault.cachedRead(m.file).catch(() => '')));
		// A newer render started while the notes were being read.
		if (token !== this.renderToken) return;

		this.matches = matches;
		this.selected = 0;
		this.resultsEl.empty();
		if (matches.length === 0) {
			if (query && this.plugin.index.availability() === 'ready') this.renderMessage('No matching notes.');
			return;
		}

		const terms = highlightTerms(query);
		const showScores = this.plugin.settings.showScores;

		matches.forEach((match, i) => {
			const item = this.resultsEl.createDiv('semantic-search-result');
			item.toggleClass('is-selected', i === 0);

			const header = item.createDiv('semantic-search-result-header');
			header.createSpan({ cls: 'semantic-search-result-title', text: match.file.basename });
			if (showScores) {
				header.createSpan({ cls: 'semantic-search-result-score', text: `${Math.round(match.score * 100)}%` });
			}

			const folder = match.file.parent && !match.file.parent.isRoot() ? match.file.parent.path : '';
			const location = [folder, match.chunk.heading].filter(Boolean).join(' › ');
			if (location) item.createDiv({ cls: 'semantic-search-result-path', text: location });

			const excerpt = excerptFor(contents[i] ?? '', match.chunk);
			if (excerpt) renderHighlighted(item.createDiv('semantic-search-result-excerpt'), excerpt, terms);

			item.addEventListener('mousemove', () => {
				if (this.selected !== i) this.select(i);
			});
			item.addEventListener('click', (evt: MouseEvent) => {
				void this.openMatch(match, Keymap.isModEvent(evt) ? 'tab' : 'current');
			});
		});
	}

	private renderInstructions(): void {
		const mod = Platform.isMacOS ? '⌘' : 'Ctrl';
		const instructions: Array<[string, string]> = [
			['↑↓', 'to navigate'],
			['↵', 'to open'],
			[`${mod} ↵`, 'to open in new tab'],
			[Platform.isMacOS ? '⌥ ↵' : 'Alt ↵', 'to insert link'],
			['esc', 'to dismiss'],
		];
		const el = this.contentEl.createDiv('prompt-instructions');
		for (const [command, purpose] of instructions) {
			const instruction = el.createDiv('prompt-instruction');
			instruction.createSpan({ cls: 'prompt-instruction-command', text: command });
			instruction.createSpan({ text: purpose });
		}
	}

	private select(index: number): void {
		if (this.matches.length === 0) return;
		const items = this.resultsEl.querySelectorAll('.semantic-search-result');
		const next = Math.max(0, Math.min(index, this.matches.length - 1));
		items[this.selected]?.removeClass('is-selected');
		this.selected = next;
		items[next]?.addClass('is-selected');
		items[next]?.scrollIntoView({ block: 'nearest' });
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	private async openMatch(match: NoteMatch, mode: OpenMode): Promise<void> {
		if (mode === 'link') {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice('Open a note in editing mode to insert a link.');
				return;
			}
			this.close();
			view.editor.replaceSelection(this.app.fileManager.generateMarkdownLink(match.file, view.file?.path ?? ''));
			return;
		}

		this.close();
		const leaf = this.app.workspace.getLeaf(mode === 'tab' ? 'tab' : false);
		await leaf.openFile(match.file, { active: true, eState: { line: match.chunk.line } });
		const view = leaf.view;
		if (view instanceof MarkdownView && view.getMode() === 'source') {
			const line = Math.min(match.chunk.line, view.editor.lineCount() - 1);
			const position = { line, ch: 0 };
			view.editor.setCursor(position);
			view.editor.scrollIntoView({ from: position, to: position }, true);
		}
	}
}
