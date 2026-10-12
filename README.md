# Local Semantic Search

Search your Obsidian notes by meaning, not just by keywords. Type "how do I keep bugs off my plants" and find the note about aphids on your tomatoes, even though it never uses the word "bugs".

A small embedding model (about 23 MB by default) runs entirely on your device. Your notes never leave your computer.

## Features

- **Semantic search modal**: a quick-switcher style search like Omnisearch. It shows the best-matching passage of each note, with its folder and heading.
- **Find similar notes**: list the notes closest in meaning to the one you are reading.
- **Jump to the passage**: opening a result scrolls to the matching section, not just the top of the note.
- **Always up to date**: notes are re-indexed in the background as you edit, rename and delete them, and changes made while Obsidian was closed are picked up at startup.
- **Fast and light**: embedding runs in a background worker, so Obsidian never freezes. A search takes about 10 ms, including embedding the query.
- **Choice of models**: a tiny English model by default, a stronger English retrieval model, or a multilingual model covering about 100 languages.

## Getting started

1. Enable the plugin, then run **Open semantic search** from the command palette (or select the search icon in the ribbon).
2. Select **Build index**. The model is downloaded once, then every note is embedded on your device, at roughly 10 passages per second on a modest CPU (a typical note is one or two passages). The status bar shows progress and you can keep working; later updates only embed notes that changed.
3. Search. Results update as you type.

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move through results |
| <kbd>Enter</kbd> | Open the note at the matching passage |
| <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> | Open in a new tab |
| <kbd>Alt</kbd> + <kbd>Enter</kbd> | Insert a link to the note in the current editor |

You can assign hotkeys to any command in **Settings → Hotkeys**.

## Commands

| Command | Description |
| --- | --- |
| Open semantic search | Open the search modal. |
| Find notes similar to the current note | Open the modal listing notes related to the active note. |
| Update index | Embed new and changed notes and drop deleted ones. |
| Rebuild index | Discard the index and embed every note again. |
| Re-index current note | Embed the active note again right away. |
| Delete index | Remove the index for this vault. |

## Models

| Model | Languages | Download | Notes |
| --- | --- | --- | --- |
| [MiniLM L6](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (default) | English | ~23 MB | Smallest and fastest. |
| [BGE small](https://huggingface.co/Xenova/bge-small-en-v1.5) | English | ~34 MB | Better retrieval quality, a bit slower. |
| [E5 small](https://huggingface.co/Xenova/multilingual-e5-small) | ~100 languages | ~118 MB | Use this if your notes aren't in English. |

You can also enter any Hugging Face model that has [Transformers.js](https://huggingface.co/docs/transformers.js) ONNX weights (for example `Xenova/paraphrase-multilingual-MiniLM-L12-v2`). Changing the model rebuilds the index.

## Privacy and network use

- **Your notes stay on your device.** Embedding and search run locally, inside Obsidian. Nothing about your notes is ever sent anywhere.
- **One network request: the model download.** The first time you build the index (or switch models), the model's weights are downloaded from [huggingface.co](https://huggingface.co). This only happens when you select **Build index**, **Update index** or **Rebuild index**, or change the model. After that the plugin works offline.
- **No telemetry**, no accounts, no API keys.
- The ONNX Runtime WebAssembly engine is bundled in the plugin, so no code is ever downloaded at runtime.

## Storage

The index and downloaded models are stored in Obsidian's local app storage (IndexedDB), not in your vault:

- File sync tools (Obsidian Sync, iCloud, Dropbox, Git) never pick up large or frequently changing index files.
- Each device builds its own index. Models are downloaded once per device and shared by all vaults.
- **Settings → Local Semantic Search → Delete index and models** frees all of it.

As a rough guide, the index needs about 1.5 KB per passage (about 15 MB for 10,000 passages).

## Settings

- **Embedding model**: see [Models](#models).
- **Index automatically**: once the index is built, keep it up to date in the background (on by default).
- **Excluded folders**: one per line; notes in these folders are never indexed.
- **Passage length / overlap**: how notes are split before embedding. Notes are split at headings and paragraphs, and each passage is embedded with its note title and heading for context.
- **Maximum results** and **Show similarity scores**.

## Limitations

- Desktop only for now. Nothing in the code depends on Node.js or Electron, but performance and memory use haven't been tested on mobile.
- The default model only understands English. Use E5 small for other languages.
- Semantic search finds related ideas, not exact strings. For exact phrases, use Obsidian's core search or Omnisearch alongside this plugin.

## Development

```bash
npm install
npm run dev     # watch build into main.js
npm run build   # type-check and production build
npm run lint
npm test        # unit tests (Node's built-in test runner)
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/local-semantic-search/` to try it out.

### How it works

```
src/
  main.ts                 plugin lifecycle, vault events, status bar
  commands.ts             command palette commands
  settings.ts             settings model and defaults
  embedding/
    worker.ts             web worker: Transformers.js on ONNX Runtime (WebAssembly)
    embedder.ts           plugin-side client for the worker
    models.ts             model presets
  index/
    chunker.ts            markdown-aware passage splitting
    vectorIndex.ts        in-memory exact cosine-similarity search
    indexStore.ts         IndexedDB persistence (one record per note)
    indexManager.ts       incremental sync with the vault, search API
  storage/                IndexedDB helpers and the model file cache
  ui/                     search modal and settings tab
```

At build time, `scripts/build-worker.mjs` bundles the embedding worker together with ONNX Runtime's WebAssembly-only build. The `.wasm` binary is gzip-compressed (about 2.8 MB) and inlined, and the worker is embedded in `main.js` as a string, so the release is still just `main.js`, `manifest.json` and `styles.css`.
