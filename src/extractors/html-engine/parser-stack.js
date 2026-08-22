import { defineHtmlEngine } from "./contract.js";

const NODE_FILTER = Object.freeze({ SHOW_ELEMENT: 1 });

function isElementNode(node) {
  return Boolean(node && typeof node === "object" && String(node.kind || node.type).toLowerCase() === "element");
}

function normalizeAttributes(attributes) {
  if (!Array.isArray(attributes)) {
    return [];
  }
  return attributes
    .filter(
      (attribute) =>
        attribute &&
        (typeof attribute.name === "string" || typeof attribute.localName === "string"),
    )
    .map((attribute) => ({
      name: String(
        attribute.name ||
          (attribute.prefix ? `${attribute.prefix}:${attribute.localName}` : attribute.localName),
      ),
      namespace: attribute.namespaceUri || null,
      value: attribute.value == null ? "" : String(attribute.value),
    }));
}

function readAttribute(attributes, name) {
  if (!name) {
    return null;
  }
  const target = String(name).toLowerCase();
  for (const attribute of attributes) {
    if (attribute.name.toLowerCase() === target) {
      return attribute.value;
    }
  }
  return null;
}

function splitClassNames(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function collectDescendantElements(rootNode) {
  if (!rootNode) {
    return [];
  }
  const descendants = [];
  const rootChildren = Array.isArray(rootNode.children) ? rootNode.children : [];
  const stack = [];
  for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
    stack.push(rootChildren[index]);
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (!isElementNode(node)) {
      continue;
    }
    descendants.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return descendants;
}

function findFirstByTagName(rootNode, tagName) {
  if (!rootNode || !tagName) {
    return null;
  }
  const normalized = String(tagName).toUpperCase();
  const stack = [...collectDescendantElements(rootNode)];
  for (const element of stack) {
    if (element.tagName === normalized) {
      return element;
    }
  }
  return null;
}

class ParserElement {
  constructor({ ownerDocument, tagName, namespaceUri, attributes, parentElement }) {
    this.kind = "element";
    this.type = "element";
    this.nodeType = 1;
    this.tagName = String(tagName || "").toUpperCase();
    this.localName = String(tagName || "").toLowerCase();
    this.namespaceUri = namespaceUri || null;
    this.attributes = normalizeAttributes(attributes);
    this._ownerDocument = ownerDocument;
    this._parentElement = parentElement;
    this._children = [];
    this._contentParts = [];
  }

  get ownerDocument() {
    return this._ownerDocument;
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  get classList() {
    return splitClassNames(this.getAttribute("class"));
  }

  get children() {
    return this._children;
  }

  get parentElement() {
    return this._parentElement;
  }

  get previousElementSibling() {
    const parent = this._parentElement;
    if (!parent) {
      return null;
    }
    const index = parent._children.indexOf(this);
    if (index <= 0) {
      return null;
    }
    return parent._children[index - 1] || null;
  }

  get textContent() {
    let output = "";
    for (const part of this._contentParts) {
      if (typeof part === "string") {
        output += part;
      } else if (isElementNode(part)) {
        output += part.textContent;
      }
    }
    return output;
  }

  getAttribute(name) {
    return readAttribute(this.attributes, name);
  }

  querySelector(selector) {
    return this._ownerDocument._queryOne(selector, this, false);
  }

  querySelectorAll(selector) {
    return this._ownerDocument._queryAll(selector, this, false);
  }

  matches(selector) {
    return this._ownerDocument._matches(selector, this);
  }

  remove() {
    const parent = this._parentElement;
    if (!parent) {
      const rootChildren = this._ownerDocument.children;
      const rootIndex = rootChildren.indexOf(this);
      if (rootIndex !== -1) {
        rootChildren.splice(rootIndex, 1);
      }
      this._ownerDocument._recomputeMetadata();
      return;
    }

    const index = parent._children.indexOf(this);
    if (index !== -1) {
      parent._children.splice(index, 1);
    }
    parent._contentParts = parent._contentParts.filter((part) => part !== this);
    this._parentElement = null;
    this._ownerDocument._recomputeMetadata();
  }

  _appendText(text) {
    if (text) {
      this._contentParts.push(String(text));
    }
  }

  _appendChild(childElement) {
    if (!isElementNode(childElement)) {
      return;
    }
    this._children.push(childElement);
    this._contentParts.push(childElement);
  }
}

class ParserDocument {
  constructor({ cssParser, url }) {
    this.kind = "document";
    this.type = "document";
    this.children = [];
    this._cssParser = cssParser;
    this._selectorCache = new Map();
    this._title = "";
    this.body = null;
    this.location = { href: url || "" };
  }

  get title() {
    return this._title;
  }

  set title(value) {
    this._title = value || "";
  }

  _recomputeMetadata() {
    this.body = findFirstByTagName(this, "body") || this.children[0] || null;
    const titleNode = findFirstByTagName(this, "title");
    this.title = titleNode ? titleNode.textContent : "";
  }

  querySelector(selector) {
    return this._queryOne(selector, this, true);
  }

  querySelectorAll(selector) {
    return this._queryAll(selector, this, true);
  }

  createTreeWalker(rootNode) {
    const nodes = collectDescendantElements(rootNode);
    let index = 0;
    return {
      nextNode() {
        const node = nodes[index] || null;
        index += 1;
        return node;
      },
    };
  }

  _queryOne(selector, rootNode, includeRoot) {
    const all = this._queryAll(selector, rootNode, includeRoot);
    return all[0] || null;
  }

  _queryAll(selector, rootNode, includeRoot) {
    if (!selector || !rootNode) {
      return [];
    }
    try {
      const selectorList = this._parseSelector(selector);
      if (!selectorList) {
        return [];
      }
      const result = this._cssParser.querySelectorList(
        selectorList,
        rootNode,
        this._selectorEnvironment(),
      );
      const matches = Array.from(result.matches || []).filter(isElementNode);
      if (!includeRoot && matches[0] === rootNode) {
        return matches.slice(1);
      }
      return matches;
    } catch (error) {
      return [];
    }
  }

  _matches(selector, node) {
    if (!selector || !node) {
      return false;
    }
    try {
      const selectorList = this._parseSelector(selector);
      if (!selectorList) {
        return false;
      }
      const result = this._cssParser.matchSelectorList(
        selectorList,
        node,
        this,
        this._selectorEnvironment(),
        { scopes: new Set([node]) },
      );
      return result.status === "match";
    } catch (error) {
      return false;
    }
  }

  _parseSelector(selector) {
    if (this._selectorCache.has(selector)) {
      return this._selectorCache.get(selector);
    }
    const parsed = this._cssParser.parseSelectorList(selector);
    const selectorList = parsed?.ok ? parsed.value : null;
    this._selectorCache.set(selector, selectorList);
    return selectorList;
  }

  _selectorEnvironment() {
    return {
      tree: {
        data(node) {
          if (!isElementNode(node)) {
            return { kind: "other" };
          }
          return {
            kind: "element",
            namespace: node.namespaceUri,
            localName: node.localName,
            attributes: node.attributes.map((attribute) => ({
              namespace: attribute.namespace,
              localName: attribute.name,
              value: attribute.value,
            })),
          };
        },
        children(node) {
          return Array.isArray(node?.children) ? node.children : [];
        },
      },
      documentMode: { syntax: "html", quirks: "no-quirks" },
      defaultNamespace: { kind: "any" },
      idValues(_node, element) {
        const id = element.attributes.find(
          (attribute) => attribute.namespace === null && attribute.localName === "id",
        )?.value;
        return id ? [id] : [];
      },
      classNames(_node, element) {
        const value = element.attributes.find(
          (attribute) => attribute.namespace === null && attribute.localName === "class",
        )?.value;
        return splitClassNames(value);
      },
      resolveNamespacePrefix() {
        return { status: "unknown" };
      },
      attributeValueCaseSensitivity() {
        return "sensitive";
      },
      matchPseudoClass() {
        return "unknown";
      },
    };
  }
}

function buildElementTree(rawNode, ownerDocument, parentElement) {
  const element = new ParserElement({
    ownerDocument,
    tagName: rawNode.tagName || rawNode.localName,
    namespaceUri: rawNode.namespaceUri || null,
    attributes: rawNode.attributes,
    parentElement,
  });

  const rawChildren = Array.isArray(rawNode.children) ? rawNode.children : [];
  for (const child of rawChildren) {
    if (!child || typeof child !== "object") {
      continue;
    }
    if (child.kind === "text") {
      element._appendText(child.value || "");
      continue;
    }
    if (child.kind === "element") {
      const childElement = buildElementTree(child, ownerDocument, element);
      element._appendChild(childElement);
    }
  }

  return element;
}

function buildDocumentTree(parsedTree, cssParser, url) {
  const documentRef = new ParserDocument({ cssParser, url });
  const rootChildren = Array.isArray(parsedTree?.children) ? parsedTree.children : [];

  for (const child of rootChildren) {
    if (!child || child.kind !== "element") {
      continue;
    }
    const childElement = buildElementTree(child, documentRef, null);
    documentRef.children.push(childElement);
  }

  documentRef._recomputeMetadata();
  return documentRef;
}

function assertParserModules(modules) {
  const htmlParse = modules?.htmlParser?.parse;
  const parseSelectorList = modules?.cssParser?.parseSelectorList;
  const querySelectorList = modules?.cssParser?.querySelectorList;
  const matchSelectorList = modules?.cssParser?.matchSelectorList;
  if (typeof htmlParse !== "function") {
    throw new Error("parser-stack html engine requires htmlParser.parse(html)");
  }
  if (
    typeof parseSelectorList !== "function" ||
    typeof querySelectorList !== "function" ||
    typeof matchSelectorList !== "function"
  ) {
    throw new Error(
      "parser-stack html engine requires the CSS selector parse, query, and match APIs",
    );
  }
}

export function createParserStackHtmlEngine({ htmlParser, cssParser }) {
  assertParserModules({ htmlParser, cssParser });

  return defineHtmlEngine(
    {
      parse({ html, url }) {
        const parsed = htmlParser.parse(html || "");
        const parsedTree = parsed?.tree || parsed;
        const document = buildDocumentTree(parsedTree, cssParser, url);
        return {
          document,
          NodeFilter: NODE_FILTER,
          location: { href: url || "" },
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
        const documentRef =
          context.document || rootNode?.ownerDocument || (rootNode?.kind === "document" ? rootNode : null);
        if (!documentRef?.createTreeWalker || !rootNode) {
          return [];
        }

        const out = [];
        const walker = documentRef.createTreeWalker(rootNode, context.showElement || NODE_FILTER.SHOW_ELEMENT);
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
    "parserStackHtmlEngine",
  );
}
