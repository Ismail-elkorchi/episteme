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
2. Verify parser stack can load:
   - `node -e 'import("./src/extractors/html-engine/index.js").then(async ({ resolveHtmlEngine }) => { await resolveHtmlEngine(); console.log("parser-stack-ok"); })'`
3. If using local parser repos, build them and point Episteme to explicit module specifiers:
   - `export EPISTEME_HTML_PARSER_SPECIFIER=file:///absolute/path/to/html-parser/dist/mod.js`
   - `export EPISTEME_CSS_PARSER_SPECIFIER=file:///absolute/path/to/css-parser/dist/mod.js`
4. Re-run checks:
   - `npm test`
   - `npm run check:deno`
   - `npm run check:bun`

## Notes
- Episteme does not build parser dependencies during `npm install`.
- Missing parser artifacts must be corrected in parser dependency packaging or explicit local specifiers.
