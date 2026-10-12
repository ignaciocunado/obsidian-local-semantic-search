/**
 * Markdown-aware chunking. Pure functions with no Obsidian dependency.
 *
 * A note is split into blocks (paragraphs, lists, code fences, headings), and
 * blocks are packed into passages of at most `chunkSize` characters, never
 * crossing a heading unless the passage so far is tiny. Each passage keeps its
 * character range and line number in the source so search results can show an
 * excerpt and jump to the right place.
 */

export interface ChunkOptions {
	chunkSize: number;
	chunkOverlap: number;
}

/** Location of a passage inside its note. */
export interface ChunkSpan {
	/** Character offset where the passage starts. */
	start: number;
	/** Character offset where the passage ends (exclusive). */
	end: number;
	/** Zero-based line number of `start`. */
	line: number;
	/** Heading trail such as "Projects > Garden", or "" before the first heading. */
	heading: string;
}

export interface Chunk extends ChunkSpan {
	/** Text that gets embedded: title and heading context followed by the cleaned passage. */
	text: string;
}

interface Unit {
	start: number;
	end: number;
	line: number;
	heading: string;
	/** True for heading lines, which always start a new section. */
	isHeading: boolean;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Bump when chunking or text cleaning changes so existing notes get re-indexed. */
export const CHUNKER_VERSION = 1;

export function chunkingKey(options: ChunkOptions): string {
	return `v${CHUNKER_VERSION}:${options.chunkSize}:${options.chunkOverlap}`;
}

export function chunkMarkdown(content: string, title: string, options: ChunkOptions): Chunk[] {
	const chunkSize = Math.max(100, options.chunkSize);
	const chunkOverlap = Math.max(0, Math.min(options.chunkOverlap, Math.floor(chunkSize / 2)));
	const units = splitUnits(blocksOf(content), content, chunkSize);

	const chunks: Chunk[] = [];
	const minChunk = Math.floor(chunkSize / 4);
	let current: Unit[] = [];

	const length = (units: Unit[]) => {
		const first = units[0];
		const last = units[units.length - 1];
		return first && last ? last.end - first.start : 0;
	};

	const flush = (keepOverlap: boolean) => {
		const first = current[0];
		const last = current[current.length - 1];
		if (!first || !last) return;
		const body = cleanMarkdown(content.slice(first.start, last.end));
		if (body.length > 0) {
			chunks.push({
				start: first.start,
				end: last.end,
				line: first.line,
				heading: first.heading,
				text: contextHeader(title, first.heading) + body,
			});
		}
		const carried: Unit[] = [];
		if (keepOverlap && chunkOverlap > 0) {
			for (let i = current.length - 1; i > 0; i--) {
				const unit = current[i];
				if (!unit || unit.isHeading) break;
				const overlapEnd = (carried[carried.length - 1] ?? unit).end;
				if (overlapEnd - unit.start > chunkOverlap) break;
				carried.unshift(unit);
			}
		}
		current = carried;
	};

	for (const unit of units) {
		const size = length(current);
		if (current.length > 0 && unit.isHeading && size >= minChunk) {
			flush(false);
		} else if (current.length > 0 && unit.end - (current[0]?.start ?? unit.start) > chunkSize) {
			flush(true);
			// Overlap must never push a passage over the size limit.
			while (current.length > 0 && unit.end - (current[0]?.start ?? unit.start) > chunkSize) {
				current.shift();
			}
		}
		current.push(unit);
	}
	flush(false);

	if (chunks.length === 0 && title.trim().length > 0) {
		// Empty notes are still findable by their title.
		chunks.push({ start: 0, end: 0, line: 0, heading: '', text: title.trim() });
	}
	return chunks;
}

/** Title and heading trail prepended to each passage before embedding. */
function contextHeader(title: string, heading: string): string {
	const parts = [title.trim(), heading].filter(p => p.length > 0);
	return parts.length > 0 ? parts.join(' > ') + '\n\n' : '';
}

/** Split a note into blank-line separated blocks, tracking headings and code fences. */
function blocksOf(content: string): Unit[] {
	const blocks: Unit[] = [];
	const headings: string[] = [];
	let offset = frontmatterEnd(content);
	let line = content.slice(0, offset).split('\n').length - 1;
	let block: Unit | null = null;
	let fence: string | null = null;

	const close = () => {
		if (block) blocks.push(block);
		block = null;
	};

	while (offset < content.length) {
		const newline = content.indexOf('\n', offset);
		const lineEnd = newline === -1 ? content.length : newline;
		const text = content.slice(offset, lineEnd);
		const fenceMatch = FENCE.exec(text);

		if (fence) {
			if (fenceMatch?.[1] === fence) fence = null;
			if (block) block.end = lineEnd;
		} else if (text.trim().length === 0) {
			close();
		} else {
			const heading = fenceMatch ? null : HEADING.exec(text);
			if (heading) {
				close();
				const level = heading[1]?.length ?? 1;
				headings.length = level - 1;
				headings[level - 1] = cleanMarkdown(heading[2] ?? '');
				const trail = headings.filter(h => h && h.length > 0).join(' > ');
				blocks.push({ start: offset, end: lineEnd, line, heading: trail, isHeading: true });
			} else {
				if (fenceMatch) fence = fenceMatch[1] ?? null;
				const trail = headings.filter(h => h && h.length > 0).join(' > ');
				if (block) block.end = lineEnd;
				else block = { start: offset, end: lineEnd, line, heading: trail, isHeading: false };
			}
		}

		offset = lineEnd + 1;
		line++;
	}
	close();
	return blocks;
}

/** Break blocks longer than `maxSize` into sentence-sized (or, failing that, word-boundary) units. */
function splitUnits(blocks: Unit[], content: string, maxSize: number): Unit[] {
	const units: Unit[] = [];
	for (const block of blocks) {
		if (block.end - block.start <= maxSize) {
			units.push(block);
			continue;
		}
		const pieces: Array<[number, number]> = [];
		const sentence = /[^.!?\n]*(?:[.!?]+|\n|$)\s*/g;
		const text = content.slice(block.start, block.end);
		let match: RegExpExecArray | null;
		while ((match = sentence.exec(text)) !== null && match[0].length > 0) {
			pieces.push([block.start + match.index, block.start + match.index + match[0].length]);
		}
		let lineAt = block.start;
		let line = block.line;
		for (const [start, end] of pieces) {
			for (const [s, e] of hardSplit(content, start, end, maxSize)) {
				line += countNewlines(content, lineAt, s);
				lineAt = s;
				if (content.slice(s, e).trim().length === 0) continue;
				units.push({ start: s, end: e, line, heading: block.heading, isHeading: false });
			}
		}
	}
	return units;
}

function hardSplit(content: string, start: number, end: number, maxSize: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let from = start;
	while (end - from > maxSize) {
		let cut = content.lastIndexOf(' ', from + maxSize);
		if (cut <= from) cut = from + maxSize;
		ranges.push([from, cut]);
		from = cut;
	}
	ranges.push([from, end]);
	return ranges;
}

function countNewlines(content: string, from: number, to: number): number {
	let count = 0;
	for (let i = from; i < to; i++) if (content.charCodeAt(i) === 10) count++;
	return count;
}

function frontmatterEnd(content: string): number {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
	return match ? match[0].length : 0;
}

/** Strip markup that carries no meaning for the embedding model. */
export function cleanMarkdown(text: string): string {
	return text
		.replace(/%%[\s\S]*?%%/g, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/!\[\[[^\]]*\]\]/g, ' ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, '$2')
		.replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?\]\]/g, (_, page: string, section?: string) =>
			[page, section].filter(Boolean).join(' '))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
		.replace(/^[ \t]*>[ \t]?(?:\[![^\]]*\][+-]?[ \t]*)?/gm, '')
		.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
		.replace(/(\*\*|__|==|~~)(.+?)\1/g, '$2')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
