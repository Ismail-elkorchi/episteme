import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "../utils.js";

export async function buildIndex({ chunksDir, outFile }) {
  const indexPath = path.join(chunksDir, "index.json");
  const index = await readJson(indexPath, null);
  if (!index?.chunks) {
    throw new Error(`Chunk index missing at ${indexPath}`);
  }

  const documents = {};
  const enrichedChunks = [];

  for (const chunkMeta of index.chunks) {
    if (!documents[chunkMeta.docId]) {
      documents[chunkMeta.docId] = {
        docId: chunkMeta.docId,
        family: chunkMeta.family,
        url: chunkMeta.url,
        chunks: [],
      };
    }
    documents[chunkMeta.docId].chunks.push(chunkMeta.chunkId);

    const chunkPath = path.join(chunksDir, chunkMeta.path);
    const chunk = await readJson(chunkPath, null);
    const text = chunk?.text || "";
    enrichedChunks.push({
      ...chunkMeta,
      normativity: chunk?.normativity || null,
      blockType: chunk?.blockType || null,
      textPreview: text.slice(0, 1000),
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    chunks: enrichedChunks,
    documents: Object.values(documents),
  };

  await writeJson(outFile || path.join(chunksDir, "search-index.json"), output);
}

export async function queryIndex({ indexFile, term, family }) {
  const index = await readJson(indexFile, null);
  if (!index?.chunks) {
    throw new Error(`Index missing at ${indexFile}`);
  }
  const normalized = term.toLowerCase();
  const results = index.chunks.filter((chunk) => {
    if (family && chunk.family !== family) {
      return false;
    }
    const haystack = `${chunk.heading || ""} ${chunk.url} ${chunk.textPreview || ""}`.toLowerCase();
    return haystack.includes(normalized);
  });
  return results;
}
