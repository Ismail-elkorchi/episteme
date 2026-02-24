import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, sha256Hex, normalizeText } from "../utils.js";

export async function diffDirectories({ fromDir, toDir, outDir }) {
  const fromDocs = await collectDocuments(fromDir);
  const toDocs = await collectDocuments(toDir);
  const fromMap = new Map(fromDocs.map((doc) => [doc.url, doc]));

  for (const doc of toDocs) {
    const previous = fromMap.get(doc.url);
    if (!previous) {
      continue;
    }
    const diff = diffDocuments(previous, doc);
    const slug = sanitizeDocId(doc.url);
    const filePath = path.join(outDir, `${slug}.diff.json`);
    await writeJson(filePath, diff);
  }
}

function diffDocuments(oldDoc, newDoc) {
  const oldSections = indexSections(oldDoc.sections || []);
  const newSections = indexSections(newDoc.sections || []);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, info] of newSections) {
    if (!oldSections.has(id)) {
      added.push(id);
      continue;
    }
    const oldInfo = oldSections.get(id);
    if (oldInfo.hash !== info.hash) {
      changed.push(id);
    }
  }

  for (const id of oldSections.keys()) {
    if (!newSections.has(id)) {
      removed.push(id);
    }
  }

  return {
    url: newDoc.url,
    fromSnapshot: oldDoc.snapshotId || null,
    toSnapshot: newDoc.snapshotId || null,
    changedAt: new Date().toISOString(),
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
    added,
    removed,
    changed,
  };
}

function indexSections(sections) {
  const map = new Map();
  sections.forEach((section, index) => {
    const id = section.id || `section-${index + 1}`;
    const text = flattenSection(section);
    map.set(id, { id, hash: sha256Hex(Buffer.from(text, "utf8")) });
  });
  return map;
}

function flattenSection(section) {
  const blocks = section.blocks || [];
  const parts = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.type === "paragraph" || block.type === "note") {
      parts.push(block.text);
    } else if (block.type === "code") {
      parts.push(block.text);
    } else if (block.type === "list") {
      parts.push(block.items?.join("\n") || "");
    } else if (block.type === "definitionList") {
      for (const item of block.items || []) {
        parts.push(`${item.term}: ${item.definition}`);
      }
    } else if (block.type === "table") {
      const headers = block.headers || [];
      if (headers.length > 0) {
        parts.push(headers.join(" | "));
      }
      for (const row of block.rows || []) {
        parts.push(row.join(" | "));
      }
    }
  }
  return normalizeText(parts.join("\n"));
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

function sanitizeDocId(url) {
  return url
    .replace(/https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
