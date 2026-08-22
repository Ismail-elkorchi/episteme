# AGENTS.md

Repository guidance for contributors and coding agents.

## Start here

- Read `README.md` for the product and CLI.
- Read `DEVELOPMENT.md` before changing implementation or release behavior.
- Use `npm ci` for a reproducible install.

## Boundaries

- Keep extraction deterministic from a recorded snapshot and manifest.
- Preserve provenance in generated documents and chunks.
- Do not bypass access controls, CAPTCHA gates, or licensing constraints.
- Keep the npm package limited to the CLI, runtime sources, schema, license, and README.

## Required checks

- Product or extractor changes: `npm run check`.
- Packaging, dependency, schema, or release changes: `npm run check:ci`.
- Cross-runtime changes: also run `npm run check:deno` and `npm run check:bun`.
