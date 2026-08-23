# Episteme

Episteme is a deterministic, agent-first CLI for acquiring external sources and extracting
structured, attributable evidence. It records HTTP or local-file snapshots, transforms them
offline, creates bounded evidence chunks, and provides deterministic lexical retrieval.

Episteme does not decide truth or synthesize knowledge. Its output remains evidence from an
external source, with provenance and extraction limitations intact.

## Agent-first contract

Episteme is non-interactive, but its default output follows conventional CLI practice: concise,
human-readable results on stdout and diagnostics on stderr. Add `--json` when a caller needs a
stable, schema-versioned envelope. Help is always human-readable.

Discover commands and options with conventional help:

```sh
episteme --help
episteme query --help
```

Use `--progress=auto|always|never` to control progress on stderr. `auto` reports progress only
when stderr is a terminal. With `--json`, forced progress is JSON Lines on stderr while the final
envelope remains on stdout. `--debug` adds cause details to failures. The CLI is the supported
automation interface; a stable JavaScript API is not part of the package contract.

## Goals

- Reproducible extraction from a recorded snapshot and extraction configuration.
- Precise attribution to URL, snapshot, source hash, fragment, PDF page, and source span when available.
- Explicit warnings, diagnostics, confidence, and known extraction limits.
- Bounded capture, chunking, query output, and pagination suitable for agent context windows.
- Deterministic ranked retrieval without an LLM or embedding service.
- Machine-readable, versioned document, artifact, and CLI-envelope schemas.

## Non-goals

- Decide truth, rank sources by authority, or resolve contradictory claims.
- Generate or maintain a wiki.
- Provide an agent transport protocol or a universal knowledge interchange format.
- Execute source scripts or crawl arbitrary dynamic sites.
- Bypass access controls, CAPTCHA gates, or licensing restrictions.

## Quick start

```sh
npm install episteme
npx episteme pipeline --manifest ./manifest.json
npx episteme query --index ./chunks/search-index.json --term "popover algorithm" --limit 5
```

The Clivoke command parser and PDF-engine dependencies are included by the package.

The same CLI is published to JSR as `@ismail-elkorchi/episteme`. Its entrypoint is named
`./cli` so importing the package cannot accidentally execute a command:

```sh
deno run --allow-read --allow-write --allow-net --allow-env \
  jsr:@ismail-elkorchi/episteme/cli --help
```

## Manifest

The manifest is a strict JSON array. Unknown fields, invalid values, duplicate URLs, and
non-HTTP(S) URLs are rejected rather than ignored.

```json
[
  {
    "url": "https://www.w3.org/TR/example/",
    "family": "w3c",
    "authority": "normative",
    "extractor": "html"
  }
]
```

Only `url` is required. Optional fields are:

- `family`: a registered extraction family such as `w3c`, `whatwg`, `rfc`, or `generic`.
- `authority`: `normative` or `informative`.
- `extractor`: `html`, `pdf`, `text`, or `xml`.

## Commands

- `snapshot`: conditionally fetch and record bounded HTTP representations.
- `manual-ingest`: record bounded local files under canonical HTTP(S) source URLs.
- `extract`: transform recorded snapshots into structured JSON evidence without network access.
- `chunk`: split extracted blocks into bounded, overlapping, attributable chunks.
- `index`: build a deterministic BM25 lexical index over complete chunk text.
- `query`: return ranked, bounded snippets and source citations with optional filters.
- `diff`: compare complete extracted corpora, including added and removed documents.
- `pipeline`: run `snapshot`, `extract`, `chunk`, and `index`.

Use `episteme <command> --help` for exact options, defaults, and limits. In particular,
capture has configurable time, byte, retry, and source-count limits; chunk and query output
have independent character and result limits.

Snapshot targets are restricted to public network addresses by default. Use
`--allow-localhost` to admit loopback and localhost targets, and
`--allow-private-networks` to admit private-use network targets. These permissions are
independent; private-network access does not also permit localhost or other special-purpose
addresses.

Manifests and manual-ingest maps accept `-` as a bounded stdin input. Query indexes also accept
stdin, with a larger default bound suitable for corpus indexes. Override either bound explicitly
with `--max-input-bytes`. `index --out -` and `diff --out -` require `--json`; the generated
artifact is returned as `data.artifact` rather than mixed with human output.

## Determinism

Live network retrieval is not deterministic. A recorded snapshot contains the observation time,
response validators, content hash, and representation metadata. Its snapshot ID is derived from
the representation rather than the retrieval clock, so observing unchanged content is idempotent.

Derived documents, chunks, indexes, and diffs contain no execution-time timestamps. JSON is
written with stable property ordering, each derived artifact has a content fingerprint, and the
document provenance records:

- Episteme producer version.
- Extractor identity.
- Source SHA-256.
- SHA-256 of the extraction configuration, including family rules and fragment selection.

Given the same recorded snapshots, manifest, Episteme version, and options, derived artifact
bytes must be identical.

## Retrieval

`query` uses a deterministic Unicode-aware BM25 index. Results can be filtered by family,
authority, document type, and normativity. `limit`, `offset`, and `max-chars` bound context use.
Every result includes a citation containing the source URL, fragment, snapshot ID, section/block
identity, and available PDF page/span provenance.

Search-index files contain source text and therefore inherit the same trust classification as
the extracted documents.

## Trust boundary

All text originating in a captured source is marked `contentTrust: "untrusted-source"`.
Consumers must treat it as data, never as Episteme or user instructions. Static HTML extraction
does not execute scripts, but it does not make source language trustworthy.

The manifest authorizes Episteme to make the listed network requests. Episteme is a local CLI,
not a network isolation boundary; callers remain responsible for restricting the CLI's network
access when manifests are produced by less-trusted agents.

## Manual ingest

```json
[
  {
    "sourceUrl": "https://example.com/spec.pdf",
    "localPath": "/path/to/spec.pdf",
    "contentType": "application/pdf"
  }
]
```

Run:

```sh
episteme manual-ingest --map ./manual-ingest.json --snapshots ./snapshots
```

Manual ingestion is content-addressed and idempotent. Changed content creates a new snapshot;
unchanged content reuses the recorded one.

## Output and schemas

- `snapshots/`: content-addressed captured bytes, metadata, and an atomically committed source index.
- `specs/`: content-addressed evidence documents and a hash-verifying document index.
- `chunks/`: content-addressed evidence chunks, a hash-verifying chunk index, and a lexical search index.
- `diffs/diff.json`: deterministic corpus diff.
- `schema/document.schema.json`: extracted-document contract.
- `schema/artifact.schema.json`: shared derived-artifact contract.
- `schema/cli-envelope.schema.json`: process output contract.

PDF evidence retains native reading order, tables, forms, page citations, source spans,
diagnostics, and declared extraction limits.

Corpus stages write data files before atomically committing `index.json`. Readers use only files
named by that index and verify their hashes, so a failed or cancelled update leaves the previous
commit usable. Writers take adjacent exclusive locks to prevent concurrent corpus mutation.
Search indexes record their source chunk-index fingerprint; querying a stale index fails with a
rebuild hint instead of silently returning obsolete evidence.

## Compatibility

The full pipeline supports Node.js 24+ and the pinned Deno release. Runtime-specific CLI
subprocess tests execute on Node; the portable extraction and pipeline modules are tested on
both runtimes.
