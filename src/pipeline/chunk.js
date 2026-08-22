import fs from "node:fs/promises";
import path from "node:path";
import {
  readJson,
  writeJson,
  sanitizeUrlToId,
  stableSectionKey,
  normalizeText,
  sha256Hex,
} from "../utils.js";

export async function chunkAll({ inputDir, outDir }) {
  const documents = await collectDocuments(inputDir);
  const chunkIndex = [];

  for (const doc of documents) {
    const docId = sanitizeUrlToId(doc.url);
    const family = doc.family || "generic";
    const baseDir = path.join(outDir, safeFamilyDirectoryName(family));
    await fs.mkdir(baseDir, { recursive: true });

    for (const [sectionIndex, section] of doc.sections.entries()) {
      const sectionKey = stableSectionKey(section, sectionIndex);
      const blocks = section.blocks || [];
      for (const [blockIndex, block] of blocks.entries()) {
        const blockKey = block?.id || `block-${blockIndex + 1}`;
        const text = flattenBlock(block);
        if (!text) {
          continue;
        }
        const fragment = block?.source?.fragment
          ? `#${block.source.fragment}`
          : section?.id
            ? `#${section.id}`
            : null;

        const chunkId = `${docId}::${sectionKey}::${blockKey}`;
        const chunk = {
          chunkId,
          docId,
          url: doc.url,
          fragment,
          family,
          authority: doc.authority || "informative",
          sectionId: section.id || null,
          blockId: block?.id || null,
          blockType: block?.type || null,
          heading: section.heading || null,
          level: section.level || null,
          text,
          source: block?.source || section?.source || null,
          links: block?.links || [],
          diagnostics: doc.diagnostics || [],
          knownLimits: doc.pdf?.knownLimits || [],
          snapshotId: doc.snapshotId || null,
          extractedAt: doc.extractedAt || null,
          normativity: block?.normativity || null,
        };

        // Extracted IDs originate in untrusted source documents. Keep them in
        // chunk metadata, but never use them as filesystem path components.
        const fileName = `${docId}--${sha256Hex(Buffer.from(chunkId, "utf8"))}.json`;
        const filePath = path.join(baseDir, fileName);
        await writeJson(filePath, chunk);

        chunkIndex.push({
          chunkId,
          docId,
          family,
          heading: chunk.heading,
          sectionId: chunk.sectionId,
          blockId: chunk.blockId,
          blockType: chunk.blockType,
          url: chunk.url,
          fragment: chunk.fragment,
          knownLimits: chunk.knownLimits,
          path: path.relative(outDir, filePath),
          textHash: sha256Hex(Buffer.from(text, "utf8")),
        });
      }
    }
  }

  await writeJson(path.join(outDir, "index.json"), {
    generatedAt: new Date().toISOString(),
    chunks: chunkIndex,
  });
}

function safeFamilyDirectoryName(family) {
  const value = String(family || "generic");
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    return value;
  }
  return `family-${sha256Hex(Buffer.from(value, "utf8"))}`;
}

function flattenBlock(block) {
  if (!block) {
    return null;
  }
  if (block.type === "paragraph" || block.type === "note") {
    return normalizeText(block.text || "");
  }
  if (block.type === "code") {
    return normalizeText(block.text || "");
  }
  if (block.type === "list") {
    return normalizeText((block.items || []).join("\n"));
  }
  if (block.type === "definitionList") {
    return normalizeText(
      (block.items || []).map((item) => `${item.term}: ${item.definition}`).join("\n"),
    );
  }
  if (block.type === "table") {
    const headers = block.headers || [];
    const rows = block.rows || [];
    const parts = [];
    if (headers.length > 0) {
      parts.push(headers.join(" | "));
    }
    for (const row of rows) {
      parts.push(row.join(" | "));
    }
    return normalizeText(parts.join("\n"));
  }
  if (block.type === "algorithm") {
    return normalizeText(
      (block.steps || []).map((step) => `${step.stepId}. ${step.text}`).join("\n"),
    );
  }
  if (block.type === "grammar") {
    return normalizeText(
      (block.productions || []).map((prod) => `${prod.lhs} ::= ${prod.rhs}`).join("\n"),
    );
  }
  return normalizeText(block.text || "");
}

async function collectDocuments(inputDir) {
  const docs = [];
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(inputDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectDocuments(fullPath);
      docs.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const doc = await readJson(fullPath, null);
      if (doc && doc.sections) {
        docs.push(doc);
      }
    }
  }
  return docs;
}
