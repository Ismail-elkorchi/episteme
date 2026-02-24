export function extractDocument({ family, url }) {
  const FAMILY_RULES = {
    whatwg: {
      rootSelector: "main",
      sectionSelector: "main section",
      pruneSelectors: [
        "nav",
        "header",
        "footer",
        "#toc",
        ".toc",
        ".sidebar",
        ".nav",
        ".back-matter",
        ".notes",
      ],
    },
    w3c: {
      rootSelector: "main, body",
      sectionSelector: "main section, section",
      pruneSelectors: ["nav", "header", "footer", "#toc", ".toc", ".head", ".index", ".breadcrumbs"],
    },
    unicode: {
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
    tc39: {
      rootSelector: "body",
      sectionSelector: "emu-intro, emu-clause, emu-annex",
      pruneSelectors: ["nav", "header", "footer", "#toc", ".toc"],
    },
    rfc: {
      rootSelector: "main, body",
      sectionSelector: null,
      usePreAsSingleSection: true,
      pruneSelectors: ["nav", "header", "footer"],
    },
    mdn: {
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
    webdev: {
      rootSelector: "article, main, body",
      sectionSelector: null,
      useHeadings: true,
      pruneSelectors: [
        "nav",
        "header",
        "footer",
        ".toc",
        ".toc-container",
        ".webdev-footer",
        ".webdev-footer-secondary",
        ".article-actions",
        ".cta",
      ],
    },
    github: {
      rootSelector: "article.markdown-body, .markdown-body, main",
      sectionSelector: null,
      useHeadings: true,
      pruneSelectors: ["nav", "header", "footer", ".gh-header", ".js-sticky", ".toc"],
    },
    designtokens: {
      rootSelector: "main, body",
      sectionSelector: "main section, section",
      pruneSelectors: ["nav", "header", "footer", "#toc", ".toc", ".head", ".index"],
    },
    webcomponents: {
      rootSelector: "main, article, body",
      sectionSelector: null,
      useHeadings: true,
      pruneSelectors: ["nav", "header", "footer", ".toc", ".sidebar", ".breadcrumbs"],
    },
    generic: {
      rootSelector: "main, body",
      sectionSelector: "section",
      useHeadings: true,
      pruneSelectors: ["nav", "header", "footer", "#toc", ".toc"],
    },
  };

  const BLOCK_SELECTOR =
    "p, pre, ul, ol, table, blockquote, dl, emu-alg, emu-grammar, emu-code, emu-note, emu-example, emu-equation, emu-table";
  const SECTION_SELECTOR = "section, emu-intro, emu-clause, emu-annex";

  const rules = FAMILY_RULES[family] ?? FAMILY_RULES.generic;
  pruneDocument(rules.pruneSelectors ?? []);
  const root = selectRoot(rules.rootSelector);

  let sections = [];
  if (rules.usePreAsSingleSection) {
    const pre = root.querySelector("pre");
    if (pre && pre.textContent.trim().length > 0) {
      sections = [
        {
          id: pre.id || null,
          heading: document.title || "RFC",
          level: 1,
          blocks: [blockFromElement(pre)],
        },
      ];
    } else {
      sections = sectionsFromHeadings(root);
    }
  } else if (rules.sectionSelector) {
    sections = sectionsFromElements(root.querySelectorAll(rules.sectionSelector));
  } else {
    sections = sectionsFromHeadings(root);
  }

  const title = document.title || (sections[0]?.heading ?? "Untitled");
  return {
    url: url || location.href,
    title,
    family,
    extractedAt: new Date().toISOString(),
    sections,
  };

  function pruneDocument(selectors) {
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        node.remove();
      }
    }
  }

  function selectRoot(selector) {
    if (!selector) {
      return document.body;
    }
    const root = document.querySelector(selector);
    return root || document.body;
  }

  function sectionsFromElements(elements) {
    const sections = [];
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const heading = findHeading(element);
      const headingText = heading ? normalizeText(heading.textContent) : null;
      const level = heading ? headingLevel(heading) : 1;
      const id = element.id || heading?.id || heading?.querySelector("a[id]")?.id || null;
      const blocks = collectBlocks(element);
      if (!headingText && blocks.length === 0) {
        continue;
      }
      sections.push({
        id,
        heading: headingText || "Untitled",
        level,
        blocks,
      });
    }
    if (sections.length === 0) {
      const fallback = sectionsFromHeadings(document.body);
      return fallback.length > 0 ? fallback : defaultSection();
    }
    return sections;
  }

  function sectionsFromHeadings(root) {
    const sections = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = null;
    let node = walker.nextNode();
    while (node) {
      if (isHeading(node)) {
        const headingText = normalizeText(node.textContent);
        const id = node.id || node.querySelector("a[id]")?.id || null;
        current = {
          id,
          heading: headingText || "Untitled",
          level: headingLevel(node),
          blocks: [],
        };
        sections.push(current);
      } else if (current && isBlock(node) && isTopLevelBlock(node, root)) {
        const block = blockFromElement(node);
        if (block) {
          current.blocks.push(block);
        }
      }
      node = walker.nextNode();
    }
    if (sections.length === 0) {
      return defaultSection();
    }
    return sections;
  }

  function defaultSection() {
    const blocks = collectBlocks(document.body);
    return [
      {
        id: null,
        heading: document.title || "Document",
        level: 1,
        blocks,
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

  function isBlock(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
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

  function collectBlocks(container) {
    const blocks = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
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

  function blockFromElement(element) {
    const tag = element.tagName?.toLowerCase();
    if (!tag) {
      return null;
    }
    if (tag === "p") {
      const text = normalizeText(element.textContent);
      return text ? { type: "paragraph", text } : null;
    }
    if (
      tag === "pre" ||
      tag === "emu-alg" ||
      tag === "emu-grammar" ||
      tag === "emu-code" ||
      tag === "emu-equation"
    ) {
      const text = element.textContent.replace(/\n{3,}/g, "\n\n").trimEnd();
      return text ? { type: "code", text } : null;
    }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.children)
        .filter((child) => child.tagName?.toLowerCase() === "li")
        .map((li) => normalizeText(li.textContent))
        .filter(Boolean);
      if (items.length === 0) {
        return null;
      }
      return { type: "list", ordered: tag === "ol", items };
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
      return items.length > 0 ? { type: "definitionList", items } : null;
    }
    if (tag === "table" || tag === "emu-table") {
      const table = element;
      const headers = extractTableHeaders(table);
      const rows = extractTableRows(table, headers.length > 0);
      if (headers.length === 0 && rows.length === 0) {
        return null;
      }
      return { type: "table", headers, rows };
    }
    if (tag === "blockquote" || tag === "emu-note" || tag === "emu-example") {
      const text = normalizeText(element.textContent);
      return text ? { type: "note", text } : null;
    }
    return null;
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
