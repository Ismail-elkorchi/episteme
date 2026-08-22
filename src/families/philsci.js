export default {
  id: "philsci",
  label: "PhilSci-Archive",
  authority: "informative",
  documentType: "paper",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "philsci-archive.pitt.edu";
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".sidebar"],
  },
};
