# Episteme Behavior Contract

## Pipeline

Episteme operates as four composable stages:

1. `snapshot` records remote content and retrieval metadata.
2. `extract` transforms snapshots into structured documents.
3. `chunk` writes addressable blocks without allowing document-controlled IDs to escape the output directory.
4. `index` builds a searchable index from those chunks.

`pipeline` runs all four stages. `manual-ingest` creates snapshots from local files, and `diff` compares extracted directories.

## Determinism and provenance

Network retrieval is not deterministic. Given the same snapshots, manifest, version, and options, extraction, chunking, and indexing must be reproducible. Generated documents retain their source URL, snapshot reference, authority, and extractor metadata.

## Extraction

- HTML is parsed statically; scripts are not executed.
- PDF extraction uses JavaScript only and does not require a system executable.
- XML/XSD extraction emits structured schema information, including annotations, facets, model summaries, and XSD 1.1 assertions when present.
- Text extraction preserves useful line structure.

Extracted JSON documents must validate against `schema/document.schema.json`.

## Compatibility

The supported Node version is declared in `package.json` and pinned in `.tool-versions`. The extraction path is also tested with the pinned Deno and Bun versions. Runtime-specific CLI subprocess tests may run only on Node.

## Distribution

The CLI command and npm package are both named `episteme`. The npm artifact contains only runtime sources, schema, license, package metadata, and the README. A stable programmatic API is not guaranteed in the current release.
