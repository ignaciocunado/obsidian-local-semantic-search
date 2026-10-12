import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, chunkingKey, cleanMarkdown } from '../src/index/chunker';

const options = { chunkSize: 200, chunkOverlap: 0 };

test('skips frontmatter and keeps offsets and line numbers', () => {
	const note = '---\ntags: [a]\n---\nFirst paragraph.\n\nSecond paragraph.';
	const chunks = chunkMarkdown(note, 'Title', options);
	assert.equal(chunks.length, 1);
	const chunk = chunks[0]!;
	assert.equal(note.slice(chunk.start, chunk.end), 'First paragraph.\n\nSecond paragraph.');
	assert.equal(chunk.line, 3);
	assert.equal(chunk.text, 'Title\n\nFirst paragraph.\n\nSecond paragraph.');
});

test('splits at headings and records the heading trail', () => {
	const intro = 'Intro text that is long enough to stand on its own as a passage here.';
	const garden = 'Tomatoes need sun and water every day, and a stake once they grow tall.';
	const note = `${intro}\n\n# Projects\n\n## Garden\n\n${garden}`;
	const chunks = chunkMarkdown(note, 'Note', options);
	assert.equal(chunks.length, 2);
	assert.equal(chunks[0]!.heading, '');
	assert.equal(chunks[1]!.heading, 'Projects');
	assert.match(chunks[1]!.text, /^Note > Projects\n\nProjects\n\nGarden\n\nTomatoes/);
	assert.equal(note.split('\n')[chunks[1]!.line], '# Projects');
});

test('never exceeds the chunk size, splitting long paragraphs by sentence', () => {
	const sentence = 'This sentence is about forty characters. ';
	const note = sentence.repeat(30).trim();
	const chunks = chunkMarkdown(note, '', { chunkSize: 200, chunkOverlap: 0 });
	assert.ok(chunks.length >= 6);
	for (const chunk of chunks) assert.ok(chunk.end - chunk.start <= 200, `chunk of ${chunk.end - chunk.start}`);
	assert.equal(chunks[0]!.start, 0);
	assert.equal(chunks[chunks.length - 1]!.end, note.length);
});

test('overlap repeats trailing units without exceeding the chunk size', () => {
	const lines = Array.from({ length: 12 }, (_, i) => `- item number ${i} in a list`).join('\n');
	const chunks = chunkMarkdown(lines + '\n'.repeat(1) + 'x'.repeat(10), '', { chunkSize: 120, chunkOverlap: 60 });
	assert.ok(chunks.length > 1);
	for (let i = 1; i < chunks.length; i++) {
		assert.ok(chunks[i]!.start < chunks[i - 1]!.end, 'consecutive chunks overlap');
		assert.ok(chunks[i]!.end - chunks[i]!.start <= 120);
	}
});

test('code fences are kept whole and # inside them is not a heading', () => {
	const note = 'Before.\n\n```\n# not a heading\n\nstill code\n```\n\nAfter.';
	const chunks = chunkMarkdown(note, '', { chunkSize: 500, chunkOverlap: 0 });
	assert.equal(chunks.length, 1);
	assert.equal(chunks[0]!.heading, '');
	assert.match(chunks[0]!.text, /still code/);
});

test('empty notes are indexed by title only', () => {
	const chunks = chunkMarkdown('---\na: 1\n---\n', 'Lonely title', options);
	assert.deepEqual(chunks.map(c => c.text), ['Lonely title']);
	assert.deepEqual(chunkMarkdown('', '', options), []);
});

test('line numbers stay correct for sentence-split blocks', () => {
	const note = 'Heading line\n' + Array.from({ length: 20 }, (_, i) => `Line ${i} has some words in it.`).join('\n');
	const chunks = chunkMarkdown(note, '', { chunkSize: 100, chunkOverlap: 0 });
	for (const chunk of chunks) {
		const expectedLine = note.slice(0, chunk.start).split('\n').length - 1;
		assert.equal(chunk.line, expectedLine);
	}
});

test('cleanMarkdown strips syntax but keeps the words', () => {
	assert.equal(cleanMarkdown('[[Page|Alias]] and [[Other#Part]]'), 'Alias and Other Part');
	assert.equal(cleanMarkdown('![[image.png]]See [docs](https://x.y) **now**'), 'See docs now');
	assert.equal(cleanMarkdown('- [ ] task\n> [!note] quoted\n%% hidden %%'), 'task\nquoted');
});

test('chunking key changes with options', () => {
	assert.notEqual(chunkingKey({ chunkSize: 1000, chunkOverlap: 100 }), chunkingKey({ chunkSize: 800, chunkOverlap: 100 }));
});
