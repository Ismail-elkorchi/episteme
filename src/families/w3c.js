export default {
  id: "w3c",
  label: "W3C",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "www.w3.org" || url.hostname === "w3.org";
  },
  rules: {
    rootSelector: "main, body",
    sectionSelector: "main section, section",
    pruneSelectors: ["nav", "header", "footer", "#toc", ".toc", ".head", ".index", ".breadcrumbs"],
    algorithmSelectors: ["ol.algorithm", "div.algorithm > ol", ".algorithm", "emu-alg"],
    grammarSelectors: ["pre.grammar", "pre.bnf", "pre.idl", "pre.webidl", "emu-grammar"],
    informativeClasses: ["note", "non-normative", "informative", "warning", "issue", "example"],
    exampleClasses: ["example"],
    normativeClasses: ["normative"],
  },
};
