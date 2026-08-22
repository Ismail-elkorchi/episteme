export default {
  id: "github",
  label: "GitHub",
  authority: "informative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "github.com";
  },
  rules: {
    rootSelector: "article.markdown-body, .markdown-body, main",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".gh-header", ".js-sticky", ".toc"],
  },
};
