import { createParserStackHtmlEngine } from "./parser-stack.js";

const DEFAULT_HTML_ENGINE = "parser-stack";
const HTML_PARSER_SPECIFIER_ENV = "EPISTEME_HTML_PARSER_SPECIFIER";
const CSS_PARSER_SPECIFIER_ENV = "EPISTEME_CSS_PARSER_SPECIFIER";
const PARSER_STACK_REMEDIATION_DOC = "docs/PARSER_STACK_REMEDIATION.md";

function readOptionalEnv(name) {
  try {
    return process?.env?.[name];
  } catch (error) {
    return undefined;
  }
}

function normalizeEngineId(value) {
  const normalized = String(value || DEFAULT_HTML_ENGINE)
    .trim()
    .toLowerCase();

  if (normalized === "parser") {
    return "parser-stack";
  }
  return DEFAULT_HTML_ENGINE;
}

function parserStackHtmlModuleSpecifiers() {
  return [
    readOptionalEnv(HTML_PARSER_SPECIFIER_ENV),
    "@ismail-elkorchi/html-parser",
    "html-parser",
    new URL("../../../../html-parser/dist/mod.js", import.meta.url).href,
  ].filter(Boolean);
}

function parserStackCssModuleSpecifiers() {
  return [
    readOptionalEnv(CSS_PARSER_SPECIFIER_ENV),
    "@ismail-elkorchi/css-parser",
    "css-parser",
    new URL("../../../../css-parser/dist/mod.js", import.meta.url).href,
  ].filter(Boolean);
}

async function importFromCandidates(label, candidates) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      return { module, candidate };
    } catch (error) {
      errors.push(`${candidate}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(
    `Unable to import ${label}. Parser artifacts may be unavailable. See ${PARSER_STACK_REMEDIATION_DOC}. Tried: ${errors.join(" | ")}`,
  );
}

export async function loadParserStackModules() {
  const htmlResult = await importFromCandidates("html-parser", parserStackHtmlModuleSpecifiers());
  const cssResult = await importFromCandidates("css-parser", parserStackCssModuleSpecifiers());
  return {
    htmlParser: htmlResult.module,
    cssParser: cssResult.module,
    source: {
      htmlParser: htmlResult.candidate,
      cssParser: cssResult.candidate,
    },
  };
}

export async function resolveHtmlEngine() {
  const engineId = normalizeEngineId();
  try {
    const modules = await loadParserStackModules();
    return createParserStackHtmlEngine(modules);
  } catch (error) {
    throw new Error(
      `Unable to load parser stack modules for engine "${engineId}". See ${PARSER_STACK_REMEDIATION_DOC}. Cause: ${error?.message || String(error)}`,
    );
  }
}
