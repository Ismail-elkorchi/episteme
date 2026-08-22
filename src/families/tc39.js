export default {
  id: "tc39",
  label: "TC39",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "tc39.es";
  },
  rules: {
    rootSelector: "body",
    sectionSelector: "emu-intro, emu-clause, emu-annex",
    pruneSelectors: ["nav", "header", "footer", "#toc", ".toc"],
  },
};
