import { App, Notice, TFile } from 'obsidian';
import { getBatchEmbeddings } from './embeddingClient';
import { ChromaService } from './chromaService';
import type { Chunk } from '../types';
import type { SemanticSearchSettings } from '../settings';

const BATCH_SIZE = 10; // Number of chunks to embed at once

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Index a single file: remove existing chunks, re-chunk, embed, and store.
 */
export async function indexFile(
	file: TFile,
	app: App,
	chroma: ChromaService,
	settings: SemanticSearchSettings
): Promise<void> {
	const content = await app.vault.read(file);
	const chunks = chunkText(file.path, file.basename, content, settings);

	// Remove old chunks for this file (if any)
	await chroma.deleteByFilePath(file.path);

	if (chunks.length === 0) return;

	await embedAndStore(chunks, chroma, settings);
}

/**
 * Remove a file's chunks from the index.
 */
export async function removeFile(
	filePath: string,
	chroma: ChromaService
): Promise<void> {
	await chroma.deleteByFilePath(filePath);
}

/**
 * Index all markdown files in the vault, showing progress via Notice.
 */
export async function indexVault(
	app: App,
	chroma: ChromaService,
	settings: SemanticSearchSettings
): Promise<void> {
	const excludedFolders = settings.excludedFolders
		.split(',')
		.map(f => f.trim())
		.filter(f => f.length > 0);

	const files = app.vault.getMarkdownFiles().filter(f => {
		return !excludedFolders.some(folder => f.path.startsWith(folder + '/') || f.path === folder);
	});

	if (files.length === 0) {
		new Notice('Semantic Search: no markdown files to index.');
		return;
	}

	const notice = new Notice(`Semantic Search: indexing 0 / ${files.length} files…`, 0);

	let indexed = 0;
	let failed = 0;

	for (const file of files) {
		try {
			await indexFile(file, app, chroma, settings);
			indexed++;
		} catch (err) {
			console.error(`Semantic Search: failed to index ${file.path}`, err);
			failed++;
		}
		notice.setMessage(
			`Semantic Search: indexing ${indexed} / ${files.length} files…`
		);
	}

	notice.hide();

	const summary = failed > 0
		? `Semantic Search: indexed ${indexed} files (${failed} failed). Check console for details.`
		: `Semantic Search: indexed ${indexed} files successfully.`;
	new Notice(summary, 4000);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split note content into overlapping text chunks.
 * Strategy: split by paragraphs, merge until chunkSize is reached, then
 * carry over the last `chunkOverlap` characters into the next chunk.
 */
export function chunkText(
	filePath: string,
	title: string,
	text: string,
	settings: SemanticSearchSettings
): Chunk[] {
	const { chunkSize, chunkOverlap } = settings;

	// Strip YAML front-matter
	const cleaned = text.replace(/^---[\s\S]*?---\n?/, '').trim();
	if (!cleaned) return [];

	const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);

	const chunks: Chunk[] = [];
	let buffer = '';
	let chunkIndex = 0;

	const flush = () => {
		const trimmed = buffer.trim();
		if (trimmed.length === 0) return;
		chunks.push({
			id: `${filePath}::${chunkIndex}`,
			text: trimmed,
			filePath,
			title,
			chunkIndex,
		});
		chunkIndex++;
	};

	for (const para of paragraphs) {
		// If a single paragraph exceeds chunkSize, split it by sentences
		if (para.length > chunkSize) {
			if (buffer.length > 0) {
				flush();
				buffer = buffer.slice(-chunkOverlap);
			}
			const sentences = splitSentences(para);
			for (const sentence of sentences) {
				if (buffer.length + sentence.length + 1 > chunkSize && buffer.length > 0) {
					flush();
					buffer = buffer.slice(-chunkOverlap) + ' ' + sentence;
				} else {
					buffer = buffer ? buffer + ' ' + sentence : sentence;
				}
			}
			continue;
		}

		// Normal paragraph: add to buffer
		if (buffer.length + para.length + 2 > chunkSize && buffer.length > 0) {
			flush();
			buffer = buffer.slice(-chunkOverlap) + '\n\n' + para;
		} else {
			buffer = buffer ? buffer + '\n\n' + para : para;
		}
	}

	if (buffer.trim().length > 0) {
		flush();
	}

	return chunks;
}

/** Naive sentence splitter — splits on '. ', '! ', '? ' */
function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

// ---------------------------------------------------------------------------
// Embed + store
// ---------------------------------------------------------------------------

async function embedAndStore(
	chunks: Chunk[],
	chroma: ChromaService,
	settings: SemanticSearchSettings
): Promise<void> {
	// Process in batches to avoid huge payloads
	for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
		const batch = chunks.slice(i, i + BATCH_SIZE);
		const texts = batch.map(c => c.text);
		const embeddings = await getBatchEmbeddings(texts, settings);

		await chroma.upsert(
			batch.map(c => c.id),
			embeddings,
			batch.map(c => c.text),
			batch.map(c => ({
				filePath: c.filePath,
				title: c.title,
				chunkIndex: c.chunkIndex,
			}))
		);
	}
}
