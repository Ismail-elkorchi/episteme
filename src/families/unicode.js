export default {
  id: "unicode",
  label: "Unicode",
  authority: "normative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return /unicode\.org$/.test(url.hostname);
  },
  rules: {
    rootSelector: "body",
    sectionSelector: null,
    useHeadings: true,
    pruneSelectors: [
      "nav",
      "header",
      "footer",
      "#toc",
      ".toc",
      ".navbar",
      ".nav",
      "table.header",
      "#header",
    ],
  },
};
