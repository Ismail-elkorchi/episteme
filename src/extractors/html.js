export function extractHtmlDocument({
  rules,
  url,
  family,
  authority,
  snapshotId,
  source,
  documentType,
  dom,
}) {
  const config = rules || {};
  const pruneSelectors = config.pruneSelectors || [];
  const algorithmSelectors = config.algorithmSelectors || [];
  const grammarSelectors = config.grammarSelectors || [];
  const informativeClasses = new Set(
    config.informativeClasses || [
      "note",
      "informative",
      "non-normative",
      "warning",
      "issue",
      "ednote",
      "advisement",
    ],
  );
  const exampleClasses = new Set(config.exampleClasses || ["example", "examples"]);
  const normativeClasses = new Set(config.normativeClasses || ["normative"]);
  const BLOCK_SELECTOR =
    "p, pre, ul, ol, table, blockquote, dl, emu-alg, emu-grammar, emu-code, emu-note, emu-example, emu-equation, emu-table";
  const SECTION_SELECTOR = "section, emu-intro, emu-clause, emu-annex";

  const doc = dom?.document ?? (typeof document !== "undefined" ? document : null);
  const win = dom?.window ?? (typeof window !== "undefined" ? window : null);
  const nodeFilter = dom?.NodeFilter ?? win?.NodeFilter ?? (typeof NodeFilter !== "undefined" ? NodeFilter : null);
  const HTMLElementCtor =
    dom?.HTMLElement ?? win?.HTMLElement ?? (typeof HTMLElement !== "undefined" ? HTMLElement : null);
  const ElementCtor = dom?.Element ?? win?.Element ?? (typeof Element !== "undefined" ? Element : null);
  const locationRef = dom?.location ?? (typeof location !== "undefined" ? location : { href: url });
  const showElement = nodeFilter?.SHOW_ELEMENT ?? 1;
  const baseUrl = (url || locationRef?.href || "").split("#")[0];
  const documentAuthority = authority || "informative";

  pruneDocument(pruneSelectors);
  const root = selectRoot(config.rootSelector);

  let sections = [];
  if (config.usePreAsSingleSection) {
    const pre = root?.querySelector("pre");
    if (pre && pre.textContent.trim().length > 0) {
      sections = [
        {
          id: pre.id || null,
          heading: doc?.title || "Document",
          level: 1,
          blocks: [blockFromElement(pre)].filter(Boolean),
          source: buildSource(pre, pre.id || null),
        },
      ];
    } else {
      sections = sectionsFromHeadings(root);
    }
  } else if (config.sectionSelector) {
    sections = sectionsFromElements(root?.querySelectorAll(config.sectionSelector) || []);
  } else {
    sections = sectionsFromHeadings(root);
  }

  const title = doc?.title || (sections[0]?.heading ?? "Untitled");
  return {
    schemaVersion: "0.2",
    url: url || locationRef?.href || "",
    title,
    family: family || "generic",
    authority: documentAuthority,
    documentType: documentType || null,
    snapshotId: snapshotId || null,
    source: source || null,
    extractedAt: new Date().toISOString(),
    sections,
  };

  function pruneDocument(selectors) {
    if (!doc) {
      return;
    }
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll(selector)) {
        node.remove();
      }
    }
  }

  function selectRoot(selector) {
    if (!doc) {
      return null;
    }
    if (!selector) {
      return doc.body;
    }
    const rootNode = doc.querySelector(selector);
    return rootNode || doc.body;
  }

  function sectionsFromElements(elements) {
    const results = [];
    for (const element of elements) {
      if (HTMLElementCtor && !(element instanceof HTMLElementCtor)) {
        continue;
      }
      const heading = findHeading(element);
      const headingText = heading ? normalizeText(heading.textContent) : null;
      const level = heading ? headingLevel(heading) : 1;
      const id = resolveSectionId(element, heading);
      const blocks = collectBlocks(element);
      if (!headingText && blocks.length === 0) {
        continue;
      }
      results.push({
        id,
        heading: headingText || "Untitled",
        level,
        blocks,
        source: buildSource(heading || element, id),
      });
    }
    if (results.length === 0) {
      const fallback = sectionsFromHeadings(doc?.body);
      return fallback.length > 0 ? fallback : defaultSection();
    }
    return results;
  }

  function sectionsFromHeadings(rootNode) {
    const results = [];
    if (!rootNode || !doc) {
      return results;
    }
    const walker = doc.createTreeWalker(rootNode, showElement);
    let current = null;
    let node = walker.nextNode();
    while (node) {
      if (isHeading(node)) {
        const headingText = normalizeText(node.textContent);
        const id = resolveSectionId(node, node);
        current = {
          id,
          heading: headingText || "Untitled",
          level: headingLevel(node),
          blocks: [],
          source: buildSource(node, id),
        };
        results.push(current);
      } else if (current && isBlock(node) && isTopLevelBlock(node, rootNode)) {
        if (!isInsideNestedSection(node, rootNode)) {
          const block = blockFromElement(node);
          if (block) {
            current.blocks.push(block);
          }
        }
      }
      node = walker.nextNode();
    }
    if (results.length === 0) {
      return defaultSection();
    }
    return results;
  }

  function defaultSection() {
    const blocks = collectBlocks(doc?.body);
    return [
      {
        id: null,
        heading: doc?.title || "Document",
        level: 1,
        blocks,
        source: buildSource(doc?.body, null),
      },
    ];
  }

  function findHeading(element) {
    return element.querySelector("h1, h2, h3, h4, h5, h6");
  }

  function isHeading(node) {
    return node.tagName && /^H[1-6]$/.test(node.tagName);
  }

  function headingLevel(node) {
    return Number(node.tagName?.slice(1)) || 1;
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function resolveSectionId(container, heading) {
    const byId = container?.id || heading?.id;
    if (byId) {
      return byId;
    }
    const anchor =
      heading?.querySelector("[id], a[name]") || container?.querySelector("[id], a[name]");
    if (anchor) {
      return anchor.getAttribute("id") || anchor.getAttribute("name");
    }
    const link = heading?.querySelector("a[href^='#']");
    if (link) {
      return link.getAttribute("href").replace(/^#/, "");
    }
    return null;
  }

  function resolveBlockId(element) {
    if (element.id) {
      return element.id;
    }
    const anchor = element.querySelector("[id], a[name]");
    if (anchor) {
      return anchor.getAttribute("id") || anchor.getAttribute("name");
    }
    return null;
  }

  function buildSource(element, id) {
    const fragment = id || null;
    return {
      url: fragment ? `${baseUrl}#${fragment}` : baseUrl,
      fragment,
      path: element ? domPath(element) : null,
    };
  }

  function domPath(element) {
    if (!element || (ElementCtor && !(element instanceof ElementCtor))) {
      return null;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== doc?.body) {
      const tag = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) {
          index += 1;
        }
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function extractLinks(element) {
    const links = [];
    for (const anchor of element.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      const text = normalizeText(anchor.textContent) || href;
      const resolvedId = href.startsWith("#") ? href.replace(/^#/, "") : null;
      links.push({ text, href, resolvedId });
    }
    return links;
  }

  function detectNormativity(element) {
    let current = element;
    while (current && current !== doc?.body) {
      if (current.classList) {
        for (const cls of current.classList) {
          if (exampleClasses.has(cls)) {
            return "example";
          }
          if (informativeClasses.has(cls)) {
            return "informative";
          }
          if (normativeClasses.has(cls)) {
            return "normative";
          }
        }
      }
      current = current.parentElement;
    }
    return documentAuthority === "normative" ? "normative" : "informative";
  }

  function matchesSelectorList(element, selectors) {
    if (!selectors || selectors.length === 0) {
      return false;
    }
    return selectors.some((selector) => element.matches(selector));
  }

  function isBlock(node) {
    if (HTMLElementCtor && !(node instanceof HTMLElementCtor)) {
      return false;
    }
    if (matchesSelectorList(node, algorithmSelectors)) {
      return true;
    }
    if (matchesSelectorList(node, grammarSelectors)) {
      return true;
    }
    return node.matches(BLOCK_SELECTOR);
  }

  function isTopLevelBlock(node, container) {
    let parent = node.parentElement;
    while (parent && parent !== container) {
      if (parent.matches && parent.matches(BLOCK_SELECTOR)) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }

  function isInsideNestedSection(node, container) {
    let parent = node.parentElement;
    while (parent && parent !== container) {
      if (parent.matches && parent.matches(SECTION_SELECTOR)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function collectBlocks(container) {
    const blocks = [];
    if (!container || !doc) {
      return blocks;
    }
    const walker = doc.createTreeWalker(container, showElement);
    let node = walker.nextNode();
    while (node) {
      if (isBlock(node) && isTopLevelBlock(node, container) && !isInsideNestedSection(node, container)) {
        const block = blockFromElement(node);
        if (block) {
          blocks.push(block);
        }
      }
      node = walker.nextNode();
    }
    return blocks;
  }

  function blockFromElement(element) {
    const tag = element.tagName?.toLowerCase();
    if (!tag) {
      return null;
    }

    if (matchesSelectorList(element, algorithmSelectors)) {
      const algorithm = parseAlgorithm(element);
      return algorithm ? decorateBlock(element, algorithm) : null;
    }

    if (matchesSelectorList(element, grammarSelectors)) {
      const grammar = parseGrammar(element);
      return grammar ? decorateBlock(element, grammar) : null;
    }

    if (tag === "p") {
      const text = normalizeText(element.textContent);
      return text ? decorateBlock(element, { type: "paragraph", text }) : null;
    }
    if (
      tag === "pre" ||
      tag === "emu-alg" ||
      tag === "emu-grammar" ||
      tag === "emu-code" ||
      tag === "emu-equation"
    ) {
      const text = element.textContent.replace(/\n{3,}/g, "\n\n").trimEnd();
      return text ? decorateBlock(element, { type: "code", text }) : null;
    }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.children)
        .filter((child) => child.tagName?.toLowerCase() === "li")
        .map((li) => normalizeText(li.textContent))
        .filter(Boolean);
      if (items.length === 0) {
        return null;
      }
      return decorateBlock(element, { type: "list", ordered: tag === "ol", items });
    }
    if (tag === "dl") {
      const items = [];
      let current = null;
      for (const child of Array.from(element.children)) {
        const childTag = child.tagName?.toLowerCase();
        if (childTag === "dt") {
          if (current) {
            items.push(current);
          }
          current = { term: normalizeText(child.textContent), definition: "" };
        } else if (childTag === "dd") {
          if (!current) {
            current = { term: "", definition: "" };
          }
          const definition = normalizeText(child.textContent);
          current.definition = current.definition
            ? `${current.definition} ${definition}`.trim()
            : definition;
        }
      }
      if (current) {
        items.push(current);
      }
      return items.length > 0 ? decorateBlock(element, { type: "definitionList", items }) : null;
    }
    if (tag === "table" || tag === "emu-table") {
      const headers = extractTableHeaders(element);
      const rows = extractTableRows(element, headers.length > 0);
      if (headers.length === 0 && rows.length === 0) {
        return null;
      }
      return decorateBlock(element, { type: "table", headers, rows });
    }
    if (tag === "blockquote" || tag === "emu-note" || tag === "emu-example") {
      const text = normalizeText(element.textContent);
      return text ? decorateBlock(element, { type: "note", text }) : null;
    }
    return null;
  }

  function decorateBlock(element, block) {
    const id = block.id || resolveBlockId(element);
    const sourceBlock = buildSource(element, id);
    const links = extractLinks(element);
    const normativity = detectNormativity(element);
    return {
      id,
      normativity,
      source: sourceBlock,
      links,
      ...block,
    };
  }

  function parseAlgorithm(element) {
    const list = element.tagName?.toLowerCase() === "ol" ? element : element.querySelector("ol");
    if (!list) {
      return null;
    }
    const steps = [];
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === "li");
    items.forEach((item, index) => {
      const text = normalizeText(item.textContent);
      if (text) {
        steps.push({ stepId: String(index + 1), text });
      }
    });
    if (steps.length === 0) {
      return null;
    }
    return {
      type: "algorithm",
      title: deriveAlgorithmTitle(element),
      steps,
    };
  }

  function deriveAlgorithmTitle(element) {
    const labelled = element.getAttribute("data-algorithm") || element.getAttribute("aria-label");
    if (labelled) {
      return normalizeText(labelled);
    }
    const heading = findPreviousHeading(element);
    return heading ? normalizeText(heading.textContent) : null;
  }

  function findPreviousHeading(element) {
    let current = element;
    while (current) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (isHeading(sibling)) {
          return sibling;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
      if (current === doc?.body) {
        break;
      }
    }
    return null;
  }

  function parseGrammar(element) {
    const text = element.textContent.replace(/\r\n/g, "\n").trim();
    if (!text) {
      return null;
    }
    const productions = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const match = /^\s*([^:]+)::=\s*(.+)$/.exec(line);
      if (match) {
        productions.push({ lhs: normalizeText(match[1]), rhs: normalizeText(match[2]) });
      }
    }
    if (productions.length === 0) {
      return null;
    }
    return {
      type: "grammar",
      productions,
    };
  }

  function extractTableHeaders(table) {
    const headers = [];
    const thead = table.querySelector("thead");
    if (thead) {
      const cells = thead.querySelectorAll("th, td");
      for (const cell of cells) {
        headers.push(normalizeText(cell.textContent));
      }
      return headers.filter(Boolean);
    }
    const firstRow = table.querySelector("tr");
    if (!firstRow) {
      return [];
    }
    const headCells = firstRow.querySelectorAll("th");
    if (headCells.length > 0) {
      for (const cell of headCells) {
        headers.push(normalizeText(cell.textContent));
      }
      return headers.filter(Boolean);
    }
    return [];
  }

  function extractTableRows(table, hasHeader) {
    const rows = [];
    const rowElements = Array.from(table.querySelectorAll("tbody tr"));
    if (rowElements.length === 0) {
      rowElements.push(...Array.from(table.querySelectorAll("tr")));
    }
    rowElements.forEach((row, index) => {
      if (hasHeader && index === 0 && row.querySelectorAll("th").length > 0) {
        return;
      }
      const cells = Array.from(row.querySelectorAll("th, td")).map((cell) =>
        normalizeText(cell.textContent),
      );
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
    return rows;
  }
}
