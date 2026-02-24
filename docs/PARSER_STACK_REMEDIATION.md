# Parser Stack Remediation

Back to [docs/INDEX.md](INDEX.md).

Use this runbook when HTML extraction fails to load `html-parser` or `css-parser`.

## Symptoms
- Errors include `Unable to load parser stack modules for engine "parser-stack"`.
- Errors include `Unable to import html-parser` or `Unable to import css-parser`.

## Remediation Steps
1. Reinstall dependencies from lockfile:
   - `rm -rf node_modules`
   - `npm ci`
2. Prepare parser stack artifacts:
   - `npm run prepare:parser-stack`
3. Verify parser stack can load:
   - `node -e 'import("./src/extractors/html-engine/index.js").then(async ({ resolveHtmlEngine }) => { await resolveHtmlEngine(); console.log("parser-stack-ok"); })'`
4. If using local parser repos, build them and point Episteme to explicit module specifiers:
   - `export EPISTEME_HTML_PARSER_SPECIFIER=file:///absolute/path/to/html-parser/dist/mod.js`
   - `export EPISTEME_CSS_PARSER_SPECIFIER=file:///absolute/path/to/css-parser/dist/mod.js`
5. Re-run checks:
   - `npm test`
   - `npm run check:deno`
   - `npm run check:bun`

## Notes
- `prepare:parser-stack` builds parser artifacts inside `node_modules` when they are missing.
- CI checks (`check:ci`, `check:deno`, `check:bun`) run `prepare:parser-stack` before extractor tests.
