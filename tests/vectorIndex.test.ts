import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VectorIndex } from '../src/index/vectorIndex';
import type { FileRecord } from '../src/index/vectorIndex';
import { excerptFor, highlightTerms } from '../src/ui/excerpt';
import { MODEL_PRESETS, modelKey, resolveModel } from '../src/embedding/models';

function unit(...values: number[]): number[] {
	const norm = Math.hypot(...values);
	return values.map(v => v / norm);
}

function record(path: string, vectors: number[][]): FileRecord {
	return {
		path,
		mtime: 1,
		chunkingKey: 'k',
		chunks: vectors.map((_, i) => ({ start: i * 10, end: i * 10 + 10, line: i, heading: `h${i}` })),
		vectors: Float32Array.from(vectors.flat()),
	};
}

test('ranks notes by their best passage', () => {
	const index = new VectorIndex(2);
	index.set(record('a.md', [unit(1, 0), unit(0, 1)]));
	index.set(record('b.md', [unit(1, 1)]));
	index.set(record('c.md', [unit(-1, 0)]));

	const hits = index.search(Float32Array.from(unit(0, 1)), 10);
	assert.deepEqual(hits.map(h => h.path), ['a.md', 'b.md', 'c.md']);
	assert.equal(hits[0]!.chunk.heading, 'h1');
	assert.ok(Math.abs(hits[0]!.score - 1) < 1e-6);
});

test('respects the limit and the excluded path', () => {
	const index = new VectorIndex(2);
	index.set(record('a.md', [unit(1, 0)]));
	index.set(record('b.md', [unit(1, 0.1)]));
	index.set(record('c.md', [unit(1, 0.2)]));
	const hits = index.search(Float32Array.from(unit(1, 0)), 1, 'a.md');
	assert.deepEqual(hits.map(h => h.path), ['b.md']);
});

test('replaces and deletes notes', () => {
	const index = new VectorIndex(2);
	index.set(record('a.md', [unit(1, 0), unit(0, 1)]));
	assert.equal(index.chunkCount, 2);
	index.set(record('a.md', [unit(1, 0)]));
	assert.equal(index.chunkCount, 1);
	assert.equal(index.fileCount, 1);
	assert.equal(index.delete('a.md'), true);
	assert.equal(index.fileCount, 0);
});

test('rejects vectors of the wrong size', () => {
	const index = new VectorIndex(3);
	assert.throws(() => index.set(record('a.md', [unit(1, 0)])));
});

test('note vector is the normalized mean of its passages', () => {
	const index = new VectorIndex(2);
	index.set(record('a.md', [unit(1, 0), unit(0, 1)]));
	const vector = index.noteVector('a.md')!;
	assert.ok(Math.abs(vector[0]! - Math.SQRT1_2) < 1e-6);
	assert.ok(Math.abs(vector[1]! - Math.SQRT1_2) < 1e-6);
	assert.equal(index.noteVector('missing.md'), null);
});

test('excerpts are cleaned and truncated at a word boundary', () => {
	const content = '# Title\n\n' + 'word '.repeat(100);
	const excerpt = excerptFor(content, { start: 0, end: content.length, line: 0, heading: '' });
	assert.ok(excerpt.startsWith('word word'), 'heading lines are dropped');
	assert.ok(excerpt.endsWith('…'));
	assert.ok(excerpt.length <= 221);
});

test('highlight terms drop short words and stop words', () => {
	assert.deepEqual(highlightTerms('How do I grow the tomatoes? Tomatoes!'), ['grow', 'tomatoes']);
	assert.deepEqual(highlightTerms('café crème'), ['café', 'crème']);
});

test('model presets resolve to themselves and custom ids get defaults', () => {
	for (const preset of MODEL_PRESETS) assert.equal(resolveModel(preset.id).pooling, preset.pooling);
	const custom = resolveModel(' someone/model ');
	assert.deepEqual(custom, { id: 'someone/model', dtype: 'q8', pooling: 'mean', queryPrefix: '', passagePrefix: '' });
	assert.notEqual(modelKey(resolveModel(MODEL_PRESETS[0]!.id)), modelKey(custom));
});
