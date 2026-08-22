export default {
  id: "designtokens",
  label: "Design Tokens",
  authority: "informative",
  contentTypes: ["text/html"],
  extractor: "html",
  match(url) {
    return url.hostname === "www.designtokens.org" || url.hostname === "designtokens.org";
  },
  rules: {
    rootSelector: "main, body",
    sectionSelector: "main section, section",
    pruneSelectors: ["nav", "header", "footer", "#toc", ".toc", ".head", ".index"],
  },
};
