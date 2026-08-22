import { createParserStackHtmlEngine } from "./parser-stack.js";

export async function loadParserStackModules() {
  const [htmlParser, cssParser] = await Promise.all([
    import("@ismail-elkorchi/html-parser"),
    import("@ismail-elkorchi/css-parser"),
  ]);
  return {
    htmlParser,
    cssParser,
    source: {
      htmlParser: "@ismail-elkorchi/html-parser",
      cssParser: "@ismail-elkorchi/css-parser",
    },
  };
}

export async function resolveHtmlEngine() {
  try {
    const modules = await loadParserStackModules();
    return createParserStackHtmlEngine(modules);
  } catch (error) {
    throw new Error(
      `Unable to load the HTML parser dependencies: ${error?.message || String(error)}`,
    );
  }
}
