import { cleanMarkdown } from '../index/chunker';
import type { ChunkSpan } from '../index/chunker';

const EXCERPT_LENGTH = 220;
const STOP_WORDS = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'what', 'how', 'why', 'who', 'when',
	'where', 'which', 'about', 'into', 'your', 'you', 'not', 'but', 'have', 'has',
]);

/**
 * Readable single-paragraph excerpt of a passage, without markdown syntax.
 * Heading lines are dropped: the result already shows the heading trail.
 */
export function excerptFor(content: string, chunk: ChunkSpan): string {
	const passage = content.slice(chunk.start, chunk.end).replace(/^[ \t]{0,3}#{1,6}[ \t]+.*$/gm, '');
	const text = cleanMarkdown(passage).replace(/\s+/g, ' ').trim();
	if (text.length <= EXCERPT_LENGTH) return text;
	const cut = text.lastIndexOf(' ', EXCERPT_LENGTH);
	return text.slice(0, cut > EXCERPT_LENGTH / 2 ? cut : EXCERPT_LENGTH).trimEnd() + '…';
}

/** Query words worth highlighting when they literally appear in an excerpt. */
export function highlightTerms(query: string): string[] {
	const words = query
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(w => w.length >= 3 && !STOP_WORDS.has(w));
	return [...new Set(words)];
}

/** Render `text` into `el`, wrapping occurrences of `terms` in <mark>. */
export function renderHighlighted(el: HTMLElement, text: string, terms: string[]): void {
	if (terms.length === 0) {
		el.setText(text);
		return;
	}
	const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const pattern = new RegExp(`(${escaped.join('|')})`, 'giu');
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > last) el.appendText(text.slice(last, index));
		el.createEl('mark', { text: match[0] });
		last = index + match[0].length;
	}
	if (last < text.length) el.appendText(text.slice(last));
}
