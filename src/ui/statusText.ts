import { findPreset } from '../embedding/models';
import type { IndexStatus } from '../index/indexManager';

/** Short human-readable description of what the index is doing, or null when idle. */
export function describeStatus(status: IndexStatus): string | null {
	switch (status.state) {
		case 'loading-model':
			if (!status.downloading) return 'Loading the embedding model…';
			return status.total > 0
				? `Downloading the embedding model… ${formatMegabytes(status.loaded)} of ${formatMegabytes(status.total)}`
				: 'Downloading the embedding model…';
		case 'indexing':
			return `Indexing notes… ${status.done.toLocaleString()} of ${status.total.toLocaleString()}`;
		case 'error':
			return status.message;
		case 'idle':
			return null;
	}
}

export function formatMegabytes(bytes: number): string {
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "about 23 MB" for presets, a generic phrase for custom models. */
export function downloadSizeText(modelId: string): string {
	const size = findPreset(modelId)?.downloadSize;
	return size ? `about ${size}` : 'size depends on the model';
}
