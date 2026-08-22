export default {
  id: "whatwg",
  label: "WHATWG",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return /\.spec\.whatwg\.org$/.test(url.hostname) || /whatwg\.org$/.test(url.hostname);
  },
  rules: {
    rootSelector: "main",
    sectionSelector: "main section",
    pruneSelectors: [
      "nav",
      "header",
      "footer",
      "#toc",
      ".toc",
      ".sidebar",
      ".nav",
      ".back-matter",
      ".notes",
    ],
    algorithmSelectors: ["ol.algorithm", ".algorithm > ol", "emu-alg"],
    grammarSelectors: ["emu-grammar", "pre.grammar", "pre.bnf", "pre.idl", "pre.webidl"],
    informativeClasses: ["note", "non-normative", "informative", "warning", "advisement", "example"],
    exampleClasses: ["example"],
    normativeClasses: ["normative"],
  },
};
