import { createLinkedomHtmlEngine } from "./linkedom.js";
import { createParserStackHtmlEngine } from "./parser-stack.js";

const DEFAULT_HTML_ENGINE = "linkedom";
const HTML_ENGINE_ENV = "EPISTEME_HTML_ENGINE";
const HTML_PARSER_SPECIFIER_ENV = "EPISTEME_HTML_PARSER_SPECIFIER";
const CSS_PARSER_SPECIFIER_ENV = "EPISTEME_CSS_PARSER_SPECIFIER";

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
  if (normalized === "html-parser-css-parser") {
    return "parser-stack";
  }
  return normalized;
}

function parserStackHtmlModuleSpecifiers() {
  return [
    readOptionalEnv(HTML_PARSER_SPECIFIER_ENV),
    "html-parser",
    new URL("../../../../html-parser/dist/mod.js", import.meta.url).href,
  ].filter(Boolean);
}

function parserStackCssModuleSpecifiers() {
  return [
    readOptionalEnv(CSS_PARSER_SPECIFIER_ENV),
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

  throw new Error(`Unable to import ${label}. Tried: ${errors.join(" | ")}`);
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

export function getRequestedHtmlEngineId() {
  return normalizeEngineId(readOptionalEnv(HTML_ENGINE_ENV));
}

export async function resolveHtmlEngine({ engine } = {}) {
  const engineId = normalizeEngineId(engine || readOptionalEnv(HTML_ENGINE_ENV));
  if (engineId === "linkedom") {
    return createLinkedomHtmlEngine();
  }

  if (engineId !== "parser-stack") {
    throw new Error(
      `Unsupported html engine "${engineId}". Supported engines: "linkedom", "parser-stack"`,
    );
  }

  try {
    const modules = await loadParserStackModules();
    return createParserStackHtmlEngine(modules);
  } catch (error) {
    throw new Error(
      `Unable to load parser stack modules for engine "${engineId}": ${error?.message || String(error)}`,
    );
  }
}
