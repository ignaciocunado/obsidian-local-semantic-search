import { normalizePath } from 'obsidian';
import { DEFAULT_MODEL_ID } from './embedding/models';

export interface SemanticSearchSettings {
	/** Hugging Face model id, one of MODEL_PRESETS or a custom Transformers.js-compatible model. */
	modelId: string;
	/** Keep the index up to date in the background once it has been built. */
	autoIndex: boolean;
	/** Folders (and everything below them) that are never indexed. */
	excludedFolders: string[];
	/** Maximum characters per indexed passage. */
	chunkSize: number;
	/** Characters of context repeated between consecutive passages. */
	chunkOverlap: number;
	maxResults: number;
	showScores: boolean;
}

export const DEFAULT_SETTINGS: SemanticSearchSettings = {
	modelId: DEFAULT_MODEL_ID,
	autoIndex: true,
	excludedFolders: [],
	chunkSize: 1000,
	chunkOverlap: 100,
	maxResults: 10,
	showScores: false,
};

export const CHUNK_SIZE_LIMITS = { min: 200, max: 2000, step: 100 } as const;
export const CHUNK_OVERLAP_LIMITS = { min: 0, max: 400, step: 50 } as const;
export const MAX_RESULTS_LIMITS = { min: 3, max: 50, step: 1 } as const;

/** Merge saved data over the defaults, dropping unknown keys and invalid values. */
export function normalizeSettings(saved: unknown): SemanticSearchSettings {
	const data = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
	const settings: SemanticSearchSettings = { ...DEFAULT_SETTINGS, excludedFolders: [] };

	if (typeof data.modelId === 'string' && data.modelId.trim()) settings.modelId = data.modelId.trim();
	if (typeof data.autoIndex === 'boolean') settings.autoIndex = data.autoIndex;
	if (typeof data.showScores === 'boolean') settings.showScores = data.showScores;
	if (Array.isArray(data.excludedFolders)) {
		settings.excludedFolders = parseFolderList(data.excludedFolders.filter(f => typeof f === 'string').join('\n'));
	}
	settings.chunkSize = clampNumber(data.chunkSize, CHUNK_SIZE_LIMITS, DEFAULT_SETTINGS.chunkSize);
	settings.chunkOverlap = clampNumber(data.chunkOverlap, CHUNK_OVERLAP_LIMITS, DEFAULT_SETTINGS.chunkOverlap);
	settings.maxResults = clampNumber(data.maxResults, MAX_RESULTS_LIMITS, DEFAULT_SETTINGS.maxResults);
	return settings;
}

/** Parse one folder per line (commas are accepted too), normalized and de-duplicated. */
export function parseFolderList(text: string): string[] {
	const folders = text
		.split(/[\n,]/)
		.map(f => f.trim())
		.filter(f => f.length > 0)
		.map(f => normalizePath(f))
		.filter(f => f !== '/' && f.length > 0);
	return [...new Set(folders)];
}

export function isExcluded(path: string, excludedFolders: string[]): boolean {
	return excludedFolders.some(folder => path === folder || path.startsWith(folder + '/'));
}

function clampNumber(value: unknown, limits: { min: number; max: number }, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}
