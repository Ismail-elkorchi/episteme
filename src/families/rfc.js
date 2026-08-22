export default {
  id: "rfc",
  label: "RFC Editor",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "www.rfc-editor.org" || url.hostname === "rfc-editor.org";
  },
  rules: {
    rootSelector: "main, body",
    sectionSelector: null,
    usePreAsSingleSection: true,
    pruneSelectors: ["nav", "header", "footer"],
  },
};
