import { App, Modal, Notice, TFile } from 'obsidian';
import { getEmbedding } from './embeddingClient';
import { ChromaService } from './chromaService';
import type { SearchResult } from '../types';
import type { SemanticSearchSettings } from '../settings';

const DEBOUNCE_MS = 400;
const EXCERPT_LENGTH = 180;

export class SemanticSearchModal extends Modal {
	private settings: SemanticSearchSettings;
	private chroma: ChromaService;

	private inputEl!: HTMLInputElement;
	private resultsEl!: HTMLDivElement;
	private statusEl!: HTMLDivElement;
	private spinnerEl!: HTMLSpanElement;

	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private results: SearchResult[] = [];
	private selectedIndex = 0;

	constructor(app: App, chroma: ChromaService, settings: SemanticSearchSettings) {
		super(app);
		this.chroma = chroma;
		this.settings = settings;
	}

	onOpen(): void {
		this.modalEl.addClass('semantic-search-modal');
		this.contentEl.empty();

		// ── Input row ──────────────────────────────────────────────────────────
		const inputRow = this.contentEl.createDiv('semantic-search-input-row');

		const searchIcon = inputRow.createSpan('semantic-search-icon');
		searchIcon.innerHTML = SEARCH_SVG;

		this.inputEl = inputRow.createEl('input', {
			type: 'text',
			placeholder: 'Semantic search…',
			cls: 'semantic-search-input',
		});

		this.spinnerEl = inputRow.createSpan('semantic-search-spinner');
		this.spinnerEl.innerHTML = SPINNER_SVG;
		this.spinnerEl.style.display = 'none';

		// ── Status / hint ──────────────────────────────────────────────────────
		this.statusEl = this.contentEl.createDiv('semantic-search-status');
		this.statusEl.setText('Type to search your vault semantically');

		// ── Results list ───────────────────────────────────────────────────────
		this.resultsEl = this.contentEl.createDiv('semantic-search-results');

		// ── Event listeners ────────────────────────────────────────────────────
		this.inputEl.addEventListener('input', () => this.onInput());
		this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => this.onKeydown(e));

		this.inputEl.focus();
	}

	onClose(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.contentEl.empty();
	}

	// ---------------------------------------------------------------------------
	// Input handling
	// ---------------------------------------------------------------------------

	private onInput(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		const query = this.inputEl.value.trim();
		if (!query) {
			this.clearResults();
			this.statusEl.setText('Type to search your vault semantically');
			return;
		}
		this.debounceTimer = setTimeout(() => this.runSearch(query), DEBOUNCE_MS);
	}

	private onKeydown(e: KeyboardEvent): void {
		if (this.results.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.setSelectedIndex(Math.min(this.selectedIndex + 1, this.results.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.setSelectedIndex(Math.max(this.selectedIndex - 1, 0));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const result = this.results[this.selectedIndex];
			if (result) this.openResult(result);
		}
	}

	// ---------------------------------------------------------------------------
	// Search
	// ---------------------------------------------------------------------------

	private async runSearch(query: string): Promise<void> {
		this.spinnerEl.style.display = '';
		this.statusEl.setText('Searching…');

		try {
			const embedding = await getEmbedding(query, this.settings);
			const response = await this.chroma.query(embedding, this.settings.maxResults);

			this.results = this.parseResults(response);
			this.renderResults();
		} catch (err) {
			console.error('Semantic Search error:', err);
			new Notice(`Semantic Search error: ${String(err)}`);
			this.statusEl.setText('Error — see console for details');
		} finally {
			this.spinnerEl.style.display = 'none';
		}
	}

	private parseResults(response: {
		ids: string[][];
		documents: (string | null)[][];
		metadatas: (Record<string, string | number> | null)[][];
		distances: number[][];
	}): SearchResult[] {
		const ids = response.ids[0] ?? [];
		const docs = response.documents[0] ?? [];
		const metas = response.metadatas[0] ?? [];
		const dists = response.distances[0] ?? [];

		return ids.map((id, i) => {
			const meta = metas[i] ?? {};
			const filePath = String(meta['filePath'] ?? '');
			const title = String(meta['title'] ?? filePath);
			const chunkIndex = Number(meta['chunkIndex'] ?? 0);
			const rawText = docs[i] ?? '';
			const distance = dists[i] ?? 1;

			// ChromaDB returns L2 or cosine distance — convert to a 0-1 similarity
			// For cosine distance (0-2 range): similarity = 1 - distance/2
			// For L2 distance: we normalise heuristically
			const score = Math.max(0, Math.min(1, 1 - distance / 2));

			const excerpt = rawText.length > EXCERPT_LENGTH
				? rawText.slice(0, EXCERPT_LENGTH).trimEnd() + '…'
				: rawText;

			return { id, filePath, title, excerpt, score, chunkIndex };
		});
	}

	// ---------------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------------

	private renderResults(): void {
		this.resultsEl.empty();
		this.selectedIndex = 0;

		if (this.results.length === 0) {
			this.statusEl.setText('No results found');
			return;
		}

		this.statusEl.setText(`${this.results.length} result${this.results.length === 1 ? '' : 's'}`);

		this.results.forEach((result, idx) => {
			const item = this.resultsEl.createDiv('semantic-search-result');
			if (idx === 0) item.addClass('is-selected');

			const header = item.createDiv('semantic-search-result-header');

			const titleSpan = header.createSpan('semantic-search-result-title');
			titleSpan.setText(result.title);

			const scoreSpan = header.createSpan('semantic-search-result-score');
			scoreSpan.setText(`${(result.score * 100).toFixed(0)}%`);

			const pathDiv = item.createDiv('semantic-search-result-path');
			pathDiv.setText(result.filePath);

			const excerptDiv = item.createDiv('semantic-search-result-excerpt');
			excerptDiv.setText(result.excerpt);

			item.addEventListener('click', () => this.openResult(result));
			item.addEventListener('mouseenter', () => this.setSelectedIndex(idx));
		});
	}

	private setSelectedIndex(idx: number): void {
		const items = this.resultsEl.querySelectorAll('.semantic-search-result');
		items[this.selectedIndex]?.removeClass('is-selected');
		this.selectedIndex = idx;
		const next = items[this.selectedIndex];
		next?.addClass('is-selected');
		next?.scrollIntoView({ block: 'nearest' });
	}

	private clearResults(): void {
		this.results = [];
		this.resultsEl.empty();
	}

	// ---------------------------------------------------------------------------
	// Open result
	// ---------------------------------------------------------------------------

	private async openResult(result: SearchResult): Promise<void> {
		this.close();

		const file = this.app.vault.getAbstractFileByPath(result.filePath);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${result.filePath}`);
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return;

		await leaf.openFile(file);
	}
}

// ---------------------------------------------------------------------------
// Inline SVGs (no external assets needed)
// ---------------------------------------------------------------------------

const SEARCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
	fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
</svg>`;

const SPINNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
	fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
	class="semantic-search-spin">
	<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
</svg>`;
