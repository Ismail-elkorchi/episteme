export default {
  id: "premis",
  label: "PREMIS",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "www.loc.gov" || url.hostname === "loc.gov" || url.hostname === "id.loc.gov";
  },
  rules: {
    rootSelector: "main, body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: ["nav", "header", "footer", ".toc", ".breadcrumbs"],
  },
};
