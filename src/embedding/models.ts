export type Pooling = 'mean' | 'cls';

/** Everything the embedding worker needs to know to load and run a model. */
export interface ModelSpec {
	/** Hugging Face repository id. The repo must contain ONNX weights for Transformers.js. */
	id: string;
	/** Weight precision. `q8` loads `onnx/model_quantized.onnx`, the smallest variant. */
	dtype: 'q8' | 'fp32';
	pooling: Pooling;
	/** Prepended to search queries (some retrieval models are trained with instructions). */
	queryPrefix: string;
	/** Prepended to note passages at indexing time. */
	passagePrefix: string;
}

export interface ModelPreset extends ModelSpec {
	name: string;
	description: string;
	downloadSize: string;
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
	{
		id: 'Xenova/all-MiniLM-L6-v2',
		name: 'MiniLM L6 (English)',
		description: 'Smallest and fastest. English only.',
		downloadSize: '23 MB',
		dtype: 'q8',
		pooling: 'mean',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/bge-small-en-v1.5',
		name: 'BGE small (English)',
		description: 'Better retrieval quality, a bit slower. English only.',
		downloadSize: '34 MB',
		dtype: 'q8',
		pooling: 'cls',
		queryPrefix: 'Represent this sentence for searching relevant passages: ',
		passagePrefix: '',
	},
	{
		id: 'Xenova/multilingual-e5-small',
		name: 'E5 small (multilingual)',
		description: 'Supports about 100 languages, slower to index.',
		downloadSize: '118 MB',
		dtype: 'q8',
		pooling: 'mean',
		queryPrefix: 'query: ',
		passagePrefix: 'passage: ',
	},
];

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

export function findPreset(modelId: string): ModelPreset | undefined {
	return MODEL_PRESETS.find(p => p.id === modelId);
}

/** Resolve a model id from settings into a full spec. Unknown ids are treated as custom mean-pooled models. */
export function resolveModel(modelId: string): ModelSpec {
	const preset = findPreset(modelId);
	if (preset) {
		const { id, dtype, pooling, queryPrefix, passagePrefix } = preset;
		return { id, dtype, pooling, queryPrefix, passagePrefix };
	}
	return { id: modelId.trim(), dtype: 'q8', pooling: 'mean', queryPrefix: '', passagePrefix: '' };
}

/** Stable identity of a model configuration. Vectors from different keys are not comparable. */
export function modelKey(spec: ModelSpec): string {
	return [spec.id, spec.dtype, spec.pooling, spec.queryPrefix, spec.passagePrefix].join('|');
}

export function modelDisplayName(modelId: string): string {
	return findPreset(modelId)?.name ?? modelId;
}
