# AGENTS.md

Repository guidance for contributors and coding agents.

## Start here

- Open the canonical [documentation map](docs/INDEX.md), then read
  [README.md](README.md) for the product and CLI.
- Read [DEVELOPMENT.md](DEVELOPMENT.md) before changing implementation or release behavior.
- Use `npm ci` for a reproducible install.

## Documentation map

- Keep every Markdown file reachable through [docs/INDEX.md](docs/INDEX.md).
- [SPEC.md](SPEC.md): public behavior and artifact contracts.
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution workflow.
- [SECURITY.md](SECURITY.md): vulnerability reporting and support policy.

## Boundaries

- Keep extraction deterministic from a recorded snapshot and manifest.
- Preserve provenance in generated documents and chunks.
- Preserve human-readable default output, the opt-in `--json` envelope, and the `untrusted-source` boundary.
- Reject invalid inputs explicitly; do not add artifact compatibility transforms.
- Do not bypass access controls, CAPTCHA gates, or licensing constraints.
- Keep the npm and JSR packages limited to the CLI, runtime sources, schema, license, and README.

## Required checks

- Product or extractor changes: `npm run check`.
- Packaging, dependency, schema, or release changes: `npm run check:ci`.
- Cross-runtime changes: also run `npm run check:deno`.
