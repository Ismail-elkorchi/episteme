# Episteme Specification (Developer Surface)

Back to [docs/INDEX.md](docs/INDEX.md).

This document defines operational terms used by Episteme development. It is not part of the consumer surface.

## Definitions

### Claim
A declarative statement about Episteme behavior, outputs, or process.

### Invariant
A Claim that must hold in all acceptable states. An Invariant requires an enforcement mechanism.

### Oracle
A mechanism that evaluates a Claim as PASS/FAIL (or SCORE). Examples: tests, schema validation, static analysis.

### Evidence
A durable artifact produced by an Oracle. Evidence must be machine-readable when possible and traceable to a commit/run.

### Proof (Project Meaning)
Evidence that, under Episteme’s accepted rules, is sufficient to accept a Claim.

### Falsification
A counterexample that demonstrates a Claim is false (failing test, failed validation, regression).

### Undecided
A Claim with missing or inconclusive Evidence. Undecided claims must not be presented as accepted.

## Evidence Policy
- No decision is accepted without evidence.
- Invariants must cite their enforcement Oracle and Evidence.
- If Evidence is missing, the Claim remains Undecided and the cycle must default to Search.

## Operational Requirements

### XML/XSD Extraction
- XML/XSD extraction must produce structured schema output (not plain text).

### XML/XSD Conformance
- Conform to XML Schema 1.1 Part 1 (Structures) and Part 2 (Datatypes).
- Facet and XSD 1.1 assertion extraction must be captured when present.

### Schema Validation
- Extracted documents must validate against schema/document.schema.json, including the fragment field.

### Runtime Parity
- Guarantees required: deterministic parsing of static snapshots across Node, Deno, and Bun.
- Error cost: medium; extraction parity is required for the app's core promise.
- Stability vs generativity: favor stability and cross-runtime determinism over dynamic rendering.
- Complexity budget: moderate; acceptable to add small parsing dependencies.
- Security posture: avoid external binaries and reduce runtime permissions.
- Chosen approach: linkedom for HTML and pdfjs-dist for PDF (single JS-only path).
- Trade-offs: reduced dynamic rendering fidelity; reliance on JS parsers.

### Consumer Surface
- Guarantees required: consumer artifacts exclude governance docs; published CLI is executable.
- Error cost: governance leakage into consumer packages.
- Stability vs generativity: prioritize stability and clarity over maximal features.
- Complexity budget: minimal packaging tooling.
- Security posture: least exposure of internal docs.

### Distribution
- Guarantees required: npm/jsr package metadata matches publishing account.
- Error cost: medium; incorrect scope breaks installation and discoverability.
- Stability vs generativity: favor stable naming and discoverability.
- Complexity budget: minimal.
- Security posture: no change to access or execution behavior.
- Package scope is @ismail-elkorchi/episteme with aligned repository metadata.

## Schema

### Mandate
- Problem: the document schema title referenced the pre-rebrand name and did not include the fragment field used by extraction.
- Non-goals: redesign the schema or add new extraction fields beyond current outputs.

### Criteria
- Guarantees required: schema matches current extractor output fields.
- Error cost: low to medium; mismatched schema misleads consumers.
- Stability vs generativity: favor stability; only minimal additive change.
- Complexity budget: minimal change only.
- Security posture: no change to access or execution behavior.

### Selection
- Chosen combination: update schema title and add missing fragment field.
- Trade-offs: schema remains a maintained contract and must track future output changes.
