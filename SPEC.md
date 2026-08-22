# Episteme behavior contract

## Product boundary

Episteme is an agent-first evidence acquisition and extraction CLI. It records external source
representations and produces structured, attributable evidence. It does not synthesize a wiki,
decide truth, or prescribe a downstream agent protocol or knowledge format.

The CLI and versioned JSON artifacts are the public automation surface. A stable JavaScript API
is not guaranteed.

## Process contract

Episteme is non-interactive and follows conventional CLI stream semantics:

- Default success output is concise, human-readable text on stdout.
- Default failures are concise text on stderr with a non-zero exit status and an actionable hint.
- `--json` emits one versioned success envelope on stdout or one error envelope on stderr.
- `--debug` exposes cause chains; stack traces are not part of normal output.
- `--help`, `help <command>`, and `<command> --help` are always human-readable.
- `--progress=auto` reports only when stderr is a terminal; `always` and `never` override it.
- Progress belongs on stderr and is JSON Lines when combined with `--json`.

Every JSON envelope contains `schemaVersion`, `ok`, `command`, `data`, `warnings`, `error`, and
`meta`. The schema is `schema/cli-envelope.schema.json`.

Exit codes are stable:

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Internal error |
| 2 | Invalid command or option |
| 3 | Invalid input data or artifact contract |
| 4 | Source unavailable; retryable |
| 5 | Configured resource limit exceeded |
| 6 | Extraction or transformation failed |
| 7 | Output resource is locked; retryable |
| 130 | Cancelled by SIGINT |
| 143 | Cancelled by SIGTERM |

Manifest and manual-ingest inputs may be read from `-` with a 64 MiB default bound. Query indexes
may be read from `-` with a 512 MiB default bound. `--max-input-bytes` provides an explicit bounded
override. Artifact output to `-` is supported for `index` and `diff` only with `--json`, where the
artifact is embedded in `data.artifact`.

## Pipeline

1. `snapshot` records bounded remote content and response metadata.
2. `manual-ingest` records bounded local content under a canonical HTTP(S) source URL.
3. `extract` transforms snapshots offline into schema-valid evidence documents.
4. `chunk` creates bounded evidence units without using source-controlled IDs as paths.
5. `index` builds a deterministic lexical search index over complete chunk text.
6. `query` ranks and bounds evidence results with direct source citations.
7. `diff` compares complete extracted corpora.

`pipeline` runs snapshot, extract, chunk, and index in that order.

## Snapshot identity and observation metadata

Snapshot IDs are SHA-256 fingerprints of representation metadata and content hash, excluding the
observation clock. Re-observing the same representation is idempotent and does not append duplicate
history. The initial `fetchedAt` is retained as legitimate observation evidence.

HTTP capture:

- Enforces per-request timeout and body-size limits.
- Rejects localhost, private-use, and other non-public network targets unless the invocation
  explicitly admits localhost or private-use networks.
- Uses ETag or Last-Modified validators when a recorded source provides them.
- Handles `304 Not Modified` without creating a snapshot.
- Retries only bounded transient HTTP statuses and transport failures.
- Verifies snapshot bytes against the recorded SHA-256 whenever they are loaded.

Snapshotting is the only stage permitted to use the network.

## Derived-artifact determinism

Given identical snapshots, manifest, Episteme version, and stage options, extraction, chunking,
indexing, and diffing must produce byte-identical files.

Derived artifacts:

- Do not contain wall-clock generation timestamps.
- Use stable JSON property ordering.
- Sort filesystem-derived collections before emission.
- Carry a fingerprint computed from canonical JSON content excluding the fingerprint itself.
- Reject unsupported artifact contract versions instead of applying compatibility transforms.

Document and chunk corpora are committed by content-fingerprinted `index.json` files. A stage:

1. Acquires exclusive locks for every mutable or consistency-sensitive corpus.
2. Writes each content-addressed data file atomically in its destination directory.
3. Verifies and atomically replaces the corpus index only after all data files succeed.
4. Removes obsolete indexed files after the commit; cleanup failures are warnings.

Readers ignore unindexed files, reject path escapes, verify file hashes and content identities,
and refuse malformed indexes. Consequently, interruption or failure before step 3 preserves the
previous readable corpus. SIGINT and SIGTERM are checked between bounded work units; a second
signal exits immediately.

Extracted documents additionally record the producer version, extractor, source SHA-256, and a
configuration SHA-256 covering family rules, authority, document type, and fragment selection.

## Extraction

- HTML is parsed statically; scripts are not executed.
- PDF extraction preserves structured content, forms, tables, diagnostics, known limits,
  page-level citations, and available source spans.
- XML/XSD extraction preserves annotations, facets, model summaries, and XSD 1.1 assertions.
- Text extraction preserves paragraph structure.
- Unsupported content/extractor combinations produce an attributable warning document.

Extracted JSON must validate against `schema/document.schema.json`.

## Chunking and retrieval

Chunking starts from source block boundaries. Blocks larger than the configured character limit
are split deterministically with a configured overlap. Chunk IDs derive from the document and
structural locator, never from filesystem-unsafe source identifiers.

The search index uses Unicode alphanumeric tokenization, lowercase normalization, a fixed heading
boost, and fixed BM25 parameters. Query results are deterministically ordered by score and chunk ID.
Queries support result and snippet bounds, offsets, and exact metadata filters. Result citations
carry the URL, fragment, snapshot, structural IDs, and available source-level provenance.
Each search index records its source chunk-index fingerprint. File-based query rejects a search
index whose sibling chunk index has since changed.

## Trust and uncertainty

Captured source language is untrusted input. Extracted documents, chunks, and search indexes mark
it `contentTrust: "untrusted-source"`. This label separates evidence from instructions; it is not
a claim that prompt injection can be eliminated by metadata.

Episteme preserves extraction warnings, diagnostics, confidence, and known limits. It does not
detect or resolve semantic contradictions between sources, and `authority` is recorded metadata,
not a truth score.

## Distribution and compatibility

The CLI command and npm package are named `episteme`. The package contains runtime sources,
schemas, license, package metadata, and this README only. Supported runtime versions are declared
by `package.json` and `.tool-versions` and verified in CI.
