import { TransformersEmbeddings } from 'vectra';
import type { SemanticSearchSettings } from '../settings';

export async function getEmbeddings(settings: SemanticSearchSettings) {
	switch (settings.embeddingProvider) {
		case 'transformers':
			return await TransformersEmbeddings.create({ model: settings.embeddingModel });
		default:
			throw new Error(`Unsupported embedding provider: ${settings.embeddingProvider}`);
	}
}
