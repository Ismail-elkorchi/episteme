# Parser Incident Handoff

Back to [docs/INDEX.md](INDEX.md).

Use this guide to report parser-related extraction defects with deterministic, synthetic repros.

## Where to file
- File in `episteme` when extraction behavior is wrong after parse/query results are already correct.
- File in `html-parser` when parse tree shape/tags/attributes are wrong for synthetic HTML input.
- File in `css-parser` when selector match/query behavior is wrong for a valid parsed tree.
- File in `episteme` first when ownership is unclear and mark scope as `split` or `unknown`.

## Required incident fields
- `incidentId`: stable identifier (example: `INC-2026-02-24-001`).
- `severity`: `S1` | `S2` | `S3`.
- `scope`: `upstream` | `downstream` | `not-in-scope` | `split` | `unknown`.
- summary, expected behavior, actual behavior.
- minimal synthetic input (no raw production page dumps).
- deterministic command(s) to reproduce.
- runtime matrix (`node`, `deno`, `bun`).

## Severity labels
- `S1`: crash, extraction abort, or high-impact incorrect output without practical workaround.
- `S2`: incorrect output for specific patterns with limited scope or workaround.
- `S3`: low-impact issue (minor mismatch, docs/template/process defect).

## Reproducer rules
- Use only synthetic snippets and fixture-like inputs.
- Include exact commands that deterministically reproduce the result.
- Do not include raw, full real-world HTML/CSS dumps in issue bodies or attachments.

