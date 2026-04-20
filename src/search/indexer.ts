import { App, Notice, TFile } from 'obsidian';
import { getBatchEmbeddings } from './embeddingClient';
import { VectorStore } from './searchEngine';
import type { Chunk } from '../types';
import type { SemanticSearchSettings } from '../settings';

const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function indexFile(
	file: TFile,
	app: App,
	store: VectorStore,
	settings: SemanticSearchSettings
): Promise<void> {
	const content = await app.vault.read(file);
	const chunks = chunkText(file.path, file.basename, content, settings);

	await store.deleteByFilePath(file.path);

	if (chunks.length === 0) return;

	await embedAndStore(chunks, store, settings);
}

export async function removeFile(filePath: string, store: VectorStore): Promise<void> {
	await store.deleteByFilePath(filePath);
}

export async function indexVault(
	app: App,
	store: VectorStore,
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
			await indexFile(file, app, store, settings);
			indexed++;
		} catch (err) {
			console.error(`Semantic Search: failed to index ${file.path}`, err);
			failed++;
		}
		notice.setMessage(`Semantic Search: indexing ${indexed} / ${files.length} files…`);
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

export function chunkText(
	filePath: string,
	title: string,
	text: string,
	settings: SemanticSearchSettings
): Chunk[] {
	const { chunkSize, chunkOverlap } = settings;

	const cleaned = text.replace(/^---[\s\S]*?---\n?/, '').trim();
	if (!cleaned) return [];

	const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);

	const chunks: Chunk[] = [];
	let buffer = '';
	let chunkIndex = 0;

	const flush = () => {
		const trimmed = buffer.trim();
		if (trimmed.length === 0) return;
		chunks.push({ id: `${filePath}::${chunkIndex}`, text: trimmed, filePath, title, chunkIndex });
		chunkIndex++;
	};

	for (const para of paragraphs) {
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

		if (buffer.length + para.length + 2 > chunkSize && buffer.length > 0) {
			flush();
			buffer = buffer.slice(-chunkOverlap) + '\n\n' + para;
		} else {
			buffer = buffer ? buffer + '\n\n' + para : para;
		}
	}

	if (buffer.trim().length > 0) flush();

	return chunks;
}

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
	store: VectorStore,
	settings: SemanticSearchSettings
): Promise<void> {
	for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
		const batch = chunks.slice(i, i + BATCH_SIZE);
		const embeddings = await getBatchEmbeddings(batch.map(c => c.text), settings);

		await store.upsert(
			batch.map((c, j) => ({
				id: c.id,
				embedding: embeddings[j] as number[],
				text: c.text,
				filePath: c.filePath,
				title: c.title,
				chunkIndex: c.chunkIndex,
			}))
		);
	}
}
