# Parser Stack Remediation

Back to [docs/INDEX.md](INDEX.md).

Use this runbook when HTML extraction fails to load the published parser stack packages.

## Symptoms
- Errors include `Unable to load parser stack modules for engine "parser-stack"`.
- Errors include `Unable to import html-parser` or `Unable to import css-parser`.

## Remediation Steps
1. Reinstall dependencies from lockfile:
   - `rm -rf node_modules`
   - `npm ci`
2. Verify the published packages are present:
   - `node -e 'import("@ismail-elkorchi/html-parser").then(() => import("@ismail-elkorchi/css-parser")).then(() => console.log("parser-packages-ok"))'`
3. Verify the parser stack can load:
   - `node -e 'import("./src/extractors/html-engine/index.js").then(async ({ resolveHtmlEngine }) => { await resolveHtmlEngine(); console.log("parser-stack-ok"); })'`
4. If you are intentionally developing against local parser repos, point Episteme at explicit module specifiers:
   - `export EPISTEME_HTML_PARSER_SPECIFIER=file:///absolute/path/to/html-parser/dist/mod.js`
   - `export EPISTEME_CSS_PARSER_SPECIFIER=file:///absolute/path/to/css-parser/dist/mod.js`
5. If your local parser install is a source checkout without `dist/`, opt in to source builds before rerunning checks:
   - `export EPISTEME_PREPARE_PARSER_STACK_FROM_SOURCE=1`
6. Re-run checks:
   - `npm test`
   - `npm run check:deno`
   - `npm run check:bun`

## Notes
- The default load path is the published scoped packages `@ismail-elkorchi/html-parser` and `@ismail-elkorchi/css-parser`.
- Local parser repo fallbacks are not implicit. Use `EPISTEME_HTML_PARSER_SPECIFIER` and `EPISTEME_CSS_PARSER_SPECIFIER`, or set `EPISTEME_ALLOW_LOCAL_PARSER_REPO_FALLBACK=1` for workspace fallback resolution.
- `prepare:parser-stack` is a no-op when published package `dist/` artifacts are present.
- `prepare:parser-stack` only builds source installs when `EPISTEME_PREPARE_PARSER_STACK_FROM_SOURCE=1` is set explicitly.
- CI checks (`check:ci`, `check:deno`, `check:bun`) run `prepare:parser-stack` before extractor tests.
