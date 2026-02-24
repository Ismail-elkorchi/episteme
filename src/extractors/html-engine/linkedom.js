import { parseHTML } from "linkedom";
import { defineHtmlEngine } from "./contract.js";

export function createLinkedomHtmlEngine() {
  return defineHtmlEngine(
    {
      parse({ html, url }) {
        const { document, window } = parseHTML(html || "");
        if (document && url) {
          const base = document.querySelector("base") || document.createElement("base");
          base.setAttribute("href", url);
          if (!base.parentNode && document.head) {
            document.head.prepend(base);
          }
        }
        return {
          document,
          window,
          NodeFilter: window?.NodeFilter,
          HTMLElement: window?.HTMLElement,
          Element: window?.Element,
          location: { href: url },
        };
      },

      queryOne(node, selector) {
        return node?.querySelector?.(selector) || null;
      },

      queryAll(node, selector) {
        return Array.from(node?.querySelectorAll?.(selector) || []);
      },

      matches(node, selector) {
        return Boolean(node?.matches?.(selector));
      },

      iterateElements(rootNode, context = {}) {
        const documentRef = context.document || rootNode?.ownerDocument;
        const showElement = context.showElement ?? context.NodeFilter?.SHOW_ELEMENT ?? 1;
        if (!documentRef?.createTreeWalker || !rootNode) {
          return [];
        }

        const out = [];
        const walker = documentRef.createTreeWalker(rootNode, showElement);
        let node = walker.nextNode();
        while (node) {
          out.push(node);
          node = walker.nextNode();
        }
        return out;
      },

      text(node) {
        return node?.textContent || "";
      },

      classNames(node) {
        return Array.from(node?.classList || []);
      },
    },
    "linkedomHtmlEngine",
  );
}

