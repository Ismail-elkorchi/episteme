# Contributing

## Workflow
- Repository changes are pull-request only.
- Do not commit directly to the default branch.
- Keep PR scope small and reviewable.

## Local verification
Run before opening a PR:
- `npm ci`
- `npm test`
- `npm run check:deno`
- `npm run check:bun`

For release-impacting changes:
- `npm run check:ci`

## Documentation contract
- Keep docs in present tense and aligned with current behavior.
- Keep `docs/INDEX.md` canonical for all Markdown files.

## Data handling
- Do not commit raw real-world web content to git.
- Use synthetic fixtures for reproductions whenever possible.
