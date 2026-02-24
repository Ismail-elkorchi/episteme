export default {
  id: "arxiv",
  label: "arXiv",
  authority: "informative",
  documentType: "paper",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "arxiv.org" || url.hostname === "www.arxiv.org";
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".metatable", ".extra-services"],
  },
};
