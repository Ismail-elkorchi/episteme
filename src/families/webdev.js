export default {
  id: "webdev",
  label: "web.dev",
  authority: "informative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "web.dev";
  },
  rules: {
    rootSelector: "article, main, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: [
      "nav",
      "header",
      "footer",
      ".toc",
      ".toc-container",
      ".webdev-footer",
      ".webdev-footer-secondary",
      ".article-actions",
      ".cta",
    ],
  },
};
