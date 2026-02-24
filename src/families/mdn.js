export default {
  id: "mdn",
  label: "MDN",
  authority: "informative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "developer.mozilla.org";
  },
  rules: {
    rootSelector: "article, main, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: [
      "nav",
      "header",
      "footer",
      "#sidebar-quicklinks",
      ".toc",
      ".sidebar",
      ".document-toc",
      ".article-actions",
      ".article-actions-container",
      ".document-actions",
      ".document-contributors",
      ".language-menu",
      ".breadcrumbs",
    ],
  },
};
