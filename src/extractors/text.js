import { normalizeText } from "../utils.js";

export function extractTextDocument({
  text,
  url,
  family,
  authority,
  snapshotId,
  source,
  documentType,
  title,
}) {
  const blocks = splitIntoBlocks(text).map((blockText, index) => ({
    id: `p-${index + 1}`,
    type: "paragraph",
    text: blockText,
    source: source || null,
  }));

  return {
    schemaVersion: "0.2",
    url,
    title: title || url,
    family: family || "generic",
    authority: authority || "informative",
    documentType: documentType || null,
    snapshotId: snapshotId || null,
    source: source || null,
    extractedAt: new Date().toISOString(),
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
