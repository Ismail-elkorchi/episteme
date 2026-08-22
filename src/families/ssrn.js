export default {
  id: "ssrn",
  label: "SSRN",
  authority: "informative",
  documentType: "paper",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "ssrn.com" || url.hostname.endsWith(".ssrn.com");
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".sidebar", ".social"],
  },
};
