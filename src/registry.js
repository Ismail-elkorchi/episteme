import arxiv from "./families/arxiv.js";
import core from "./families/core.js";
import designTokens from "./families/designtokens.js";
import github from "./families/github.js";
import lingbuzz from "./families/lingbuzz.js";
import mdn from "./families/mdn.js";
import philsci from "./families/philsci.js";
import premis from "./families/premis.js";
import rfc from "./families/rfc.js";
import ssrn from "./families/ssrn.js";
import tc39 from "./families/tc39.js";
import unicode from "./families/unicode.js";
import w3c from "./families/w3c.js";
import webcomponents from "./families/webcomponents.js";
import webdev from "./families/webdev.js";
import whatwg from "./families/whatwg.js";
import { inputError } from "./errors.js";

const FAMILY_PLUGINS = Object.freeze([
  arxiv,
  core,
  designTokens,
  github,
  lingbuzz,
  mdn,
  philsci,
  premis,
  rfc,
  ssrn,
  tc39,
  unicode,
  w3c,
  webcomponents,
  webdev,
  whatwg,
]);

const GENERIC_PLUGIN = Object.freeze({
  id: "generic",
  label: "Generic",
  authority: "informative",
  documentType: null,
  match() {
    return true;
  },
  contentTypes: ["text/html"],
  extractor: "html",
  rules: {
    rootSelector: "main, body",
    sectionSelector: "section",
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", "#toc", ".toc"],
  },
});

export async function loadFamilyPlugins() {
  return [...FAMILY_PLUGINS, GENERIC_PLUGIN];
}

export function resolveFamily(plugins, urlString, explicitFamily) {
  if (explicitFamily) {
    const match = plugins.find((plugin) => plugin.id === explicitFamily);
    if (match) {
      return match;
    }
    throw inputError(`Unknown extraction family: ${explicitFamily}`, { family: explicitFamily });
  }
  const url = new URL(urlString);
  for (const plugin of plugins) {
    if (plugin.id === "generic") {
      continue;
    }
    if (plugin.match?.(url)) {
      return plugin;
    }
  }
  return plugins.find((plugin) => plugin.id === "generic");
}
