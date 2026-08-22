export default {
  id: "webcomponents",
  label: "Web Components",
  authority: "informative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return (
      url.hostname === "webcomponents.dev" ||
      url.hostname === "custom-elements-manifest.open-wc.org" ||
      url.hostname === "open-wc.org"
    );
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".toc", ".sidebar", ".breadcrumbs"],
  },
};
