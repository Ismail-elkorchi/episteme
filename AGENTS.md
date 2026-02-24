# AGENTS.md (Episteme Contributor Contract)

This file defines the public, repository-local contract for contributors and coding agents working in this repository.

## Start Here
- Open [docs/INDEX.md](docs/INDEX.md) first.
- Keep the Doc Map canonical: every `.md` file must be reachable from `AGENTS.md` through the indexes.
- After Markdown changes, run the project doc-map audit in the private project workspace.

## Public Surface and Boundaries
- Keep this repository contributor-facing and product-focused.
- Preserve package boundary guarantees: consumer packages ship runtime/CLI surfaces only.
- Do not leak internal-only control artifacts into published package surfaces.
- Do not bypass access controls, CAPTCHA gates, or licensing constraints.

## Change Classes and Required Checks
- Docs/index updates: run project doc-map audit in the private project workspace.
- Product code or extractor changes: `npm run check`.
- Packaging, schema-contract, or other high-impact product checks: `npm run check:ci`.

## Contributor References
- `README.md`
- `DEVELOPMENT.md`
- `SPEC.md`
- `docs/INDEX.md`
