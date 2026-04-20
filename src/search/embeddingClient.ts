import type { SemanticSearchSettings } from './settings';

/**
 * Generate an embedding vector for a single text string.
 */
export async function getEmbedding(
	text: string,
	settings: SemanticSearchSettings
): Promise<number[]> {
	if (settings.embeddingProvider === 'ollama') {
		return ollamaEmbed([text], settings).then(v => v[0] as number[]);
	}
	return openAIEmbed([text], settings).then(v => v[0] as number[]);
}

/**
 * Generate embedding vectors for a batch of texts.
 * Batching is more efficient, especially with Ollama's /api/embed endpoint.
 */
export async function getBatchEmbeddings(
	texts: string[],
	settings: SemanticSearchSettings
): Promise<number[][]> {
	if (settings.embeddingProvider === 'ollama') {
		return ollamaEmbed(texts, settings);
	}
	return openAIEmbedBatch(texts, settings);
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function ollamaEmbed(
	texts: string[],
	settings: SemanticSearchSettings
): Promise<number[][]> {
	const url = `${settings.embeddingUrl.replace(/\/$/, '')}/api/embed`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: settings.embeddingModel,
			input: texts.length === 1 ? texts[0] : texts,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Ollama embedding error ${response.status}: ${body}`);
	}

	const data = (await response.json()) as {
		embeddings?: number[][];
		embedding?: number[];
	};

	// Older Ollama versions return { embedding: number[] } for single input
	if (data.embeddings) return data.embeddings;
	if (data.embedding) return [data.embedding];
	throw new Error('Unexpected response from Ollama: no embeddings field');
}

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

async function openAIEmbed(
	texts: string[],
	settings: SemanticSearchSettings
): Promise<number[][]> {
	return openAIEmbedBatch(texts, settings);
}

async function openAIEmbedBatch(
	texts: string[],
	settings: SemanticSearchSettings
): Promise<number[][]> {
	const url = `${settings.embeddingUrl.replace(/\/$/, '')}/v1/embeddings`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (settings.apiKey) {
		headers['Authorization'] = `Bearer ${settings.apiKey}`;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model: settings.embeddingModel,
			input: texts,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Embedding API error ${response.status}: ${body}`);
	}

	const data = (await response.json()) as {
		data: { index: number; embedding: number[] }[];
	};

	// Sort by index to maintain order
	return data.data
		.sort((a, b) => a.index - b.index)
		.map(d => d.embedding);
}
