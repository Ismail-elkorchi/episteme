export const families = [
  {
    id: "whatwg",
    label: "WHATWG",
    match(url) {
      return /\.spec\.whatwg\.org$/.test(url.hostname) || /whatwg\.org$/.test(url.hostname);
    },
  },
  {
    id: "w3c",
    label: "W3C",
    match(url) {
      return url.hostname === "www.w3.org" || url.hostname === "w3.org";
    },
  },
  {
    id: "unicode",
    label: "Unicode",
    match(url) {
      return /unicode\.org$/.test(url.hostname);
    },
  },
  {
    id: "tc39",
    label: "TC39",
    match(url) {
      return url.hostname === "tc39.es";
    },
  },
  {
    id: "rfc",
    label: "RFC Editor",
    match(url) {
      return url.hostname === "www.rfc-editor.org" || url.hostname === "rfc-editor.org";
    },
  },
  {
    id: "mdn",
    label: "MDN",
    match(url) {
      return url.hostname === "developer.mozilla.org";
    },
  },
  {
    id: "webdev",
    label: "web.dev",
    match(url) {
      return url.hostname === "web.dev";
    },
  },
  {
    id: "github",
    label: "GitHub",
    match(url) {
      return url.hostname === "github.com";
    },
  },
  {
    id: "designtokens",
    label: "Design Tokens",
    match(url) {
      return url.hostname === "www.designtokens.org" || url.hostname === "designtokens.org";
    },
  },
  {
    id: "webcomponents",
    label: "Web Components",
    match(url) {
      return (
        url.hostname === "webcomponents.dev" ||
        url.hostname === "custom-elements-manifest.open-wc.org" ||
        url.hostname === "open-wc.org"
      );
    },
  },
  {
    id: "generic",
    label: "Generic",
    match() {
      return false;
    },
  },
];

export function detectFamily(urlString, override) {
  if (override) {
    return override;
  }
  const url = new URL(urlString);
  for (const family of families) {
    if (family.id === "generic") {
      continue;
    }
    if (family.match(url)) {
      return family.id;
    }
  }
  return "generic";
}

export function listFamilies() {
  return families.map((family) => family.id);
}
