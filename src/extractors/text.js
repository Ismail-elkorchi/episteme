import { normalizeText } from "../utils.js";
import { documentBase } from "../document.js";

export function extractTextDocument({
  text,
  url,
  family,
  authority,
  snapshotId,
  source,
  documentType,
  title,
  provenance,
}) {
  const blocks = splitIntoBlocks(text).map((blockText, index) => ({
    id: `p-${index + 1}`,
    type: "paragraph",
    text: blockText,
    source: source || null,
  }));

  return {
    ...documentBase({
      url,
      title,
      family,
      authority,
      documentType,
      snapshotId,
      source,
      provenance,
    }),
    sections: [
      {
        id: null,
        heading: title || "Document",
        level: 1,
        blocks,
        source: source || null,
      },
    ],
  };
}

function splitIntoBlocks(text) {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split(/\n{2,}/g).map((part) => normalizeText(part));
  const blocks = parts.filter(Boolean);
  if (blocks.length === 0) {
    const fallback = normalizeText(normalized);
    return fallback ? [fallback] : [];
  }
  return blocks;
}
