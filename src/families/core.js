export default {
  id: "core",
  label: "CORE",
  authority: "informative",
  documentType: "paper",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "core.ac.uk" || url.hostname.endsWith(".core.ac.uk");
  },
  rules: {
    rootSelector: "main, article, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".sidebar", ".breadcrumbs"],
  },
};
