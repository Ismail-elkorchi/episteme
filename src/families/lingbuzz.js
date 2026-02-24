export default {
  id: "lingbuzz",
  label: "LingBuzz",
  authority: "informative",
  documentType: "paper",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "lingbuzz.com" || url.hostname.endsWith(".lingbuzz.com");
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".sidebar"],
  },
};
