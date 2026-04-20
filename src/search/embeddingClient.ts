import { SemanticSearchSettings } from '../settings';
import { pipeline } from '@huggingface/transformers';


/**
 * Generate an embedding vector for a single text string.
 */
export async function getEmbedding(
	text: string,
	settings: SemanticSearchSettings
): Promise<number[]> {
	if (settings.embeddingProvider === 'transformers') {
		return transformersEmbed([text], settings).then(v => v[0] as number[]);
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
	if (settings.embeddingProvider === 'transformers') {
		return transformersEmbed(texts, settings);
	}
	return openAIEmbedBatch(texts, settings);
}

// ---------------------------------------------------------------------------
// Transformers
// ---------------------------------------------------------------------------

async function transformersEmbed(
    texts: string[],
    settings: SemanticSearchSettings
): Promise<number[][]> {
    return transformersEmbedBatch(texts, settings);
}

async function transformersEmbedBatch(
    texts: string[],
    settings: SemanticSearchSettings
): Promise<number[][]> {
    const embedder = await pipeline(
        'feature-extraction',
        settings.embeddingModel
    );

    const output = await embedder(texts, { pooling: 'mean', normalize: true });
    const embeddings: number[][][] = output.tolist();

    return embeddings.map(e => (Array.isArray(e[0]) ? e[0] : e) as number[]);
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
