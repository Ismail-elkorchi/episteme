# Contributing

## Workflow

- Repository changes are pull-request only.
- Do not commit directly to the default branch.
- Keep PR scope small and reviewable.

## Local verification

Install with `npm ci`, then run `npm run check:ci` before opening a PR. Changes to extractors, dependencies, or runtime behavior must also pass `npm run check:deno`.

Keep documentation in the present tense and aligned with current behavior.

## Tests

Add a focused regression test for bug fixes and validate extracted documents against the schema. Do not commit raw real-world web content; use minimal synthetic fixtures whenever possible.
