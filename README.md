# Episteme

Back to [docs/INDEX.md](docs/INDEX.md).

Episteme is a deterministic CLI that snapshots sources and extracts structured, provenance-preserving documents.
It is built for consumers who need reliable external knowledge for their own projects.

## Goals
- Deterministic extraction from snapshots into structured documents with provenance.
- Provide a CLI pipeline for snapshot → extract → chunk → index.
- Keep uncertainty and conflicts visible rather than smoothing them away.
- Publish a machine-readable schema for extracted documents.

## Non-goals
- Decide truth or resolve conflicts by authority.
- Bypass access controls, CAPTCHAs, or licensing constraints.
- Provide a general-purpose web crawler for arbitrary dynamic sites.
- Guarantee a stable programmatic API in this release.

## Determinism
Snapshotting depends on external sources and can change over time.
Determinism here means that extraction, chunking, and indexing are reproducible from a recorded snapshot and manifest.

## Consumer Use
- Provide your own manifest (list of URLs + extractors).
- Run the CLI to snapshot, extract, chunk, and index.
- Use the outputs in your project (software, research, writing, analysis, etc.).

## Manifest Format
Episteme expects a JSON array of source entries:
```json
[
  {
    "url": "https://example.com/spec",
    "family": "w3c",
    "authority": "normative",
    "extractor": "html",
    "output": "custom-output-name",
    "label": "Example Spec"
  }
]
```

Required:
- `url`: source URL.

Optional:
- `family`: extraction family (e.g., `w3c`, `whatwg`, `rfc`, or `generic`).
- `authority`: `normative` | `informative`.
- `extractor`: `html` | `pdf` | `text` | `xml` (defaults by family).
- `output`: override output filename (without extension).
- `label`: human-readable name.

## Quick Start
```sh
npm install @ismail-elkorchi/episteme
npx @ismail-elkorchi/episteme pipeline --manifest ./manifest.json
```

## CLI Commands
- `snapshot`: fetch and store deterministic snapshots under `snapshots/`.
- `manual-ingest`: ingest local files as manual snapshots.
- `extract`: run per-family extraction rules against snapshots (no live web).
- `chunk`: emit block-level chunks under `chunks/`.
- `index`: build a search index from chunks.
- `diff`: compare two extracted directories.
- `query`: search an index for a term.
- `pipeline`: snapshot → extract → chunk → index.

## Deno/Bun Usage
```sh
deno run --allow-read --allow-write --allow-net --node-modules-dir src/cli.js pipeline --manifest ./manifest.json
bun src/cli.js pipeline --manifest ./manifest.json
```

## Manual Ingest Map
The `manual-ingest` command accepts a JSON array of local files:
```json
[
  {
    "sourceUrl": "https://example.com/spec.pdf",
    "localPath": "/path/to/spec.pdf",
    "contentType": "application/pdf"
  }
]
```

Required:
- `sourceUrl`: the canonical source URL.
- `localPath`: absolute or relative path to the local file.

Optional:
- `contentType`: MIME type (defaults to `application/octet-stream`).

## Output
- `specs/`: structured documents (JSON or Markdown)
- `chunks/`: block-level chunks + index
- `snapshots/`: raw snapshots + metadata

## Schemas
- Extracted document schema: `schema/document.schema.json`

## Compatibility
- Full pipeline (HTML + PDF): Node.js 24+ (LTS), latest stable Deno, or latest stable Bun.
