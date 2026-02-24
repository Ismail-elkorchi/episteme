export function renderJson(document) {
  return JSON.stringify(document, null, 2) + "\n";
}

export function renderMarkdown(document) {
  const lines = [];
  lines.push(`# ${document.title}`);
  lines.push("");
  lines.push(`URL: ${document.url}`);
  lines.push(`Family: ${document.family}`);
  if (document.authority) {
    lines.push(`Authority: ${document.authority}`);
  }
  if (document.snapshotId) {
    lines.push(`Snapshot: ${document.snapshotId}`);
  }
  lines.push(`Extracted: ${document.extractedAt}`);
  lines.push("");
  for (const section of document.sections) {
    const heading = section.heading || "Untitled";
    const level = Math.min(Math.max(section.level || 2, 2), 6);
    lines.push(`${"#".repeat(level)} ${heading}`);
    if (section.id) {
      lines.push("");
      lines.push(`ID: ${section.id}`);
    }
    lines.push("");
    for (const block of section.blocks) {
      lines.push(...renderBlock(block));
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderBlock(block) {
  if (!block) {
    return [];
  }
  switch (block.type) {
    case "paragraph":
      return [block.text];
    case "code":
      return ["```", block.text, "```"];
    case "list":
      return block.items.map((item) => (block.ordered ? `1. ${item}` : `- ${item}`));
    case "algorithm": {
      const lines = [];
      if (block.title) {
        lines.push(`Algorithm: ${block.title}`);
      } else {
        lines.push("Algorithm:");
      }
      for (const step of block.steps || []) {
        lines.push(`${step.stepId}. ${step.text}`);
      }
      return lines;
    }
    case "grammar":
      return (block.productions || []).map((prod) => `${prod.lhs} ::= ${prod.rhs}`);
    case "note":
      return ["> " + block.text];
    case "definitionList":
      return block.items.flatMap((item) => [`- ${item.term}: ${item.definition}`]);
    case "table":
      return renderTable(block);
    default:
      return [block.text || ""];    
  }
}

function renderTable(table) {
  const lines = [];
  const headers = table.headers || [];
  const rows = table.rows || [];
  if (headers.length > 0) {
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  }
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines;
}
