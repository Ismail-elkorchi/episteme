# Episteme Development Guide

Back to [docs/INDEX.md](docs/INDEX.md).

This document is for Episteme developers. It is not part of the consumer surface.

## Roles (Developer Surface)
- Human Developer: owns Episteme roadmap, reviews high-impact changes, and approves releases.
- Coding Agent: implements scoped changes, runs required oracles, and reports evidence.

Consumers use only the CLI and published package interfaces.

## Repository Boundary
- This repository stays contributor-facing and product-focused.
- Private method artifacts (meta loops, cycle logs, agent habits, and runtime history) are externalized from this repository.
- Do not reintroduce private control artifacts into this repository root.

## Development Surfaces
- Product code: `src/`
- Schema contract: `schema/`
- Test suite and fixtures: `tests/`
- Public contributor docs: `README.md`, `SPEC.md`, `docs/**`
- Design rationale: this document (`DEVELOPMENT.md`)

## Consumer Surface (Read-Only)
- Mandate: consumer packages must not expose governance or development content.
- Non-goals: redesigning the extraction pipeline or schema.
- npm/jsr packages should ship only runtime, CLI, and consumer docs.
- Governance and development sources must be excluded from consumer packages.
- Selection: Method A now (npm files + .npmignore + jsr excludes); trade-off is dependence on checks. Revisit a monorepo split if enforcement proves insufficient.

## Non-Goals
- Video content is out of scope; MP4 removed.

## Manual Ingest
- Manual-ingest supports refresh semantics via --refresh.
- CLI accepts --refresh for manual-ingest; README updated to document usage.
- Refresh uses file hash comparisons.
- Manual refresh sample created for validation and used to confirm refresh behavior.
- Checklist outcome: refresh validated; XML Schema 1.1 source added; coverage map updated.

## XML/XSD Extractor
- XML extractor uses fast-xml-parser and produces XSD-aware sections.
- Parser captures attributes, groups, schema metadata, annotations, facets, and model summaries.

## Verification
- Canonical command: `npm run check`
- Holdout tier: `npm run check:holdout`
- CI gate: `npm run check:ci`
- XML/XSD tests cover PREMIS facets and a synthetic XSD 1.1 assertion.
- `test:xml` runs XML extractor tests.
- XML root selection ignores XML declarations/processing instructions.
- Schema validation helper is applied in XML/HTML/PDF tests.
- Runtime parity oracles: cross-runtime HTML/PDF extraction tests; rival check vs prior Playwright extraction on a sample snapshot.
- Runtime parity falsifiers: synthetic HTML/PDF fixtures validated against schema.
- Schema verification: schema diff against output examples; fragment field check (manual until automated).
- Consumer surface verification: `npm pack --dry-run`, jsr exclude validation, and package:check failure on leaked paths.
- Distribution verification: `npm pack --dry-run`, scoped install check, and CLI bin continuity (`episteme`).

## Testing Fixtures
- PREMIS XSD and W3C xml.xsd are baseline fixtures.
- XML/XSD fixture tests were extended; XML root selection fix applied for declarations/processing instructions.

## Toolchain
- Pins are in `.tool-versions` (Node 24+, Deno, Bun). CI reads the same pins.

## Runtime Parity
- Mandate: remove Playwright and pdftotext to enable Node/Deno/Bun parity.
- Non-goals: dynamic JS execution or headless browser rendering.
- HTML extraction uses linkedom instead of Playwright.
- HTML engine can be selected with `EPISTEME_HTML_ENGINE` (`linkedom` default, `parser-stack` opt-in).
- Parser-stack engine resolves parser modules from `html-parser`/`css-parser` package names or from `EPISTEME_HTML_PARSER_SPECIFIER`/`EPISTEME_CSS_PARSER_SPECIFIER`.
- HTML parity harness compares `linkedom` and `parser-stack` on synthetic fixtures (`tests/html-parity.test.js`).
- PDF extraction uses pdfjs-dist instead of pdftotext.
- Deno/Bun test commands use --node-modules-dir.

## Decision Rationale Summary
- Parity favors a single JS-only path over runtime-specific adapters.
- Schema stays aligned with extractor output.
- Consumer surface is enforced via npm files and checks.
- Distribution stays scoped to `@ismail-elkorchi/episteme`.

## Decision Rationale

### Runtime Parity (HTML/PDF)
- Candidate methods: keep Playwright + pdftotext (Node-only), switch to linkedom + pdfjs-dist, add runtime-specific adapters, or drop HTML/PDF parity.
- Mapping: Node-only fails parity; JS-only provides a single path; adapters increase drift risk; dropping parity violates consumer requirements.

### Schema Alignment
- Candidate methods: leave schema unchanged, update title + add fragment, remove schema, or mark schema as deprecated.
- Mapping: unchanged keeps mismatch; update aligns with output; remove loses contract; deprecate increases ambiguity.

### Consumer Surface Separation
- Candidate methods: npm files + .npmignore + jsr excludes, monorepo split, postpublish scrub, or mirror repo.
- Mapping: files/excludes constrain surface; monorepo adds overhead; postpublish is fragile; mirror increases duplication and drift.

### Distribution Scope
- Candidate methods: keep unscoped, scope to @ismail-elkorchi/episteme, publish separate names, or avoid publishing.
- Mapping: unscoped conflicts with publishing plan; scoped matches target; separate names fragment; avoid publishing conflicts with distribution requirement.

## Distribution
- Mandate: package name and metadata must reflect publishing scope and GitHub repository.
- Non-goals: change CLI name or public command semantics.
- Package metadata must match GitHub repo and scope.
- Selection: scope to @ismail-elkorchi/episteme; trade-offs are minimal and limited to updated install commands.
- Packaging checks use scripts/verify-package.mjs.

## Holdout
- Holdout schema fixture for regression checks lives under `tests/fixtures/holdout/`.

## Evidence
- Runtime parity: src/extractors/html.js, src/extractors/pdf.js, src/pipeline/extract.js, tests/ (xml/html/pdf).
- Schema alignment: schema/document.schema.json, src/pipeline/extract.js.
- Consumer surface separation: scripts/verify-package.mjs, package.json files list.
- Distribution scope: package.json, jsr.json, README.md.

## Backlog
- Validate CI runs on Node/Deno/Bun for this repo.
- Add manual-ingest refresh tests (changed/unchanged files).
- Add dry-run reporting for refresh.
- Add annotation/appinfo extraction tests.
- Sample-check extracted XSD element list against the source XSD.
- Add unit tests for element/complexType/simpleType parsing.
- Compare extracted element/type counts against the source XSD.
- Add tests for annotation and facet extraction.
- Compare extracted facets against a known schema instance for coverage.
- Add unit tests for facet and assertion extraction.
- Add XML/XSD parsing tests against additional real schemas.
- Add deep constraint modeling for XSD constraints (requires new sources).
- Improve HTML extraction for W3C specs with structured headings.
- Add structured output for annotation/appinfo blocks.
- Add non-W3C XSD fixture.
- Run parity diff on real HTML/PDF snapshots.
- Validate PDF extraction on a real spec PDF per runtime.
- Integrate optional CLI schema validation.
- Run npm audit and triage high-severity issues.
- Run full pipeline under Deno/Bun for parity.
- Add schema-aware XML validation.
- Improve PDF structure recovery.
