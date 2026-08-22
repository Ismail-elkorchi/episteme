import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION, CONTENT_TRUST } from "../constants.js";
import { inputError, throwIfAborted } from "../errors.js";
import { readJsonInput } from "../execution.js";
import { hasValidFingerprint, readJson, withFingerprint, writeJson } from "../utils.js";

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export async function buildIndex({
  chunksDir,
  outFile,
  includeArtifact = false,
  signal,
  onProgress = () => {},
}) {
  const chunkIndexPath = path.join(chunksDir, "index.json");
  const chunkIndex = await readJson(chunkIndexPath, null);
  if (
    chunkIndex?.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    chunkIndex?.artifactType !== "chunk-index" ||
    !hasValidFingerprint(chunkIndex) ||
    !Array.isArray(chunkIndex.chunks) ||
    !/^[a-f0-9]{64}$/u.test(chunkIndex.sourceDocumentIndexFingerprint || "")
  ) {
    throw inputError(`Invalid chunk index: ${chunkIndexPath}`, { path: chunkIndexPath });
  }

  const documents = [];
  const chunkIds = new Set();
  const chunkPaths = new Set();
  const documentFrequency = Object.create(null);
  for (const [chunkPosition, chunkMeta] of chunkIndex.chunks.entries()) {
    throwIfAborted(signal);
    if (
      !chunkMeta ||
      typeof chunkMeta !== "object" ||
      chunkIds.has(chunkMeta.chunkId) ||
      chunkPaths.has(chunkMeta.path)
    ) {
      throw inputError("Chunk index contains a duplicate or invalid entry", { path: chunkIndexPath });
    }
    chunkIds.add(chunkMeta.chunkId);
    chunkPaths.add(chunkMeta.path);
    onProgress({
      stage: "index",
      message: `Indexing ${chunkMeta.chunkId}`,
      current: chunkPosition + 1,
      total: chunkIndex.chunks.length,
      status: "started",
    });
    const chunkPath = resolveChunkPath(chunksDir, chunkMeta.path);
    const chunk = await readJson(chunkPath, null);
    if (
      chunk?.artifactType !== "evidence-chunk" ||
      chunk?.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
      chunk?.contentTrust !== CONTENT_TRUST ||
      !hasValidFingerprint(chunk) ||
      chunk.chunkId !== chunkMeta.chunkId ||
      chunk.fingerprint !== chunkMeta.fingerprint ||
      typeof chunk.text !== "string" ||
      typeof chunk.url !== "string"
    ) {
      throw inputError(`Invalid evidence chunk: ${chunkPath}`, { path: chunkPath });
    }
    const tokens = tokenize(`${chunk.heading || ""} ${chunk.heading || ""} ${chunk.text}`);
    const termFrequency = frequencies(tokens);
    for (const term of Object.keys(termFrequency)) {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1;
    }
    documents.push({
      chunkId: chunk.chunkId,
      docId: chunk.docId,
      family: chunk.family,
      authority: chunk.authority,
      documentType: chunk.documentType,
      heading: chunk.heading,
      sectionId: chunk.sectionId,
      blockId: chunk.blockId,
      blockType: chunk.blockType,
      normativity: chunk.normativity,
      url: chunk.url,
      fragment: chunk.fragment,
      snapshotId: chunk.snapshotId,
      contentTrust: chunk.contentTrust,
      text: chunk.text,
      source: chunk.source,
      links: chunk.links,
      diagnostics: chunk.diagnostics,
      knownLimits: chunk.knownLimits,
      provenance: chunk.provenance,
      tokenCount: tokens.length,
      termFrequency,
    });
  }
  documents.sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  const tokenTotal = documents.reduce((total, document) => total + document.tokenCount, 0);
  const output = withFingerprint({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactType: "search-index",
    contentTrust: CONTENT_TRUST,
    sourceChunkIndexFingerprint: chunkIndex.fingerprint,
    algorithm: {
      name: "BM25",
      k1: BM25_K1,
      b: BM25_B,
      tokenizer: "unicode-alphanumeric-lowercase-v1",
      headingBoost: 2,
    },
    corpus: {
      documentCount: documents.length,
      averageTokenCount: documents.length === 0 ? 0 : tokenTotal / documents.length,
      documentFrequency,
    },
    documents,
  });
  const indexFile = outFile || null;
  const written = indexFile ? await writeJson(indexFile, output) : null;
  return {
    indexFile,
    fingerprint: output.fingerprint,
    bytes: written?.bytes ?? Buffer.byteLength(JSON.stringify(output), "utf8"),
    counts: { documents: documents.length, terms: Object.keys(documentFrequency).length },
    ...(includeArtifact ? { artifact: output } : {}),
  };
}

export async function queryIndex({
  indexFile,
  term,
  family,
  authority,
  documentType,
  normativity,
  limit = 10,
  offset = 0,
  maxChars = 1_200,
  inputStream = process.stdin,
  maxInputBytes = 512 * 1024 * 1024,
  signal,
}) {
  throwIfAborted(signal);
  const index = await readJsonInput(indexFile, {
    maxBytes: maxInputBytes,
    stdin: inputStream,
    label: "Search index",
    signal,
  });
  if (
    index?.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    index?.artifactType !== "search-index" ||
    !hasValidFingerprint(index) ||
    !Array.isArray(index.documents) ||
    !isSearchCorpus(index.corpus, index.documents.length) ||
    !/^[a-f0-9]{64}$/u.test(index.sourceChunkIndexFingerprint || "") ||
    index.algorithm?.name !== "BM25" ||
    index.algorithm?.tokenizer !== "unicode-alphanumeric-lowercase-v1" ||
    !index.documents.every(isSearchDocument)
  ) {
    throw inputError(`Invalid search index: ${indexFile}`, { path: indexFile });
  }
  await validateCurrentChunkIndex(indexFile, index);
  const queryTokens = [...new Set(tokenize(term))];
  if (queryTokens.length === 0) {
    return resultPage({ term, filters: {}, scored: [], limit, offset });
  }
  const normalizedTerm = term.normalize("NFKC").toLocaleLowerCase("en-US");
  const filters = removeEmpty({ family, authority, documentType, normativity });
  const scored = index.documents
    .filter((document) => matchesFilters(document, filters))
    .map((document) => ({ document, score: bm25Score(document, queryTokens, index.corpus) }))
    .filter((entry) => entry.score > 0)
    .map((entry) => ({
      ...entry,
      score: entry.score + (entry.document.text.toLocaleLowerCase("en-US").includes(normalizedTerm) ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.document.chunkId.localeCompare(right.document.chunkId));
  const page = scored.slice(offset, offset + limit).map(({ document, score }) => ({
    score: Number(score.toFixed(6)),
    chunkId: document.chunkId,
    heading: document.heading,
    blockType: document.blockType,
    normativity: document.normativity,
    contentTrust: document.contentTrust,
    snippet: makeSnippet(document.text, normalizedTerm, maxChars),
    citation: {
      url: document.url,
      fragment: document.fragment,
      snapshotId: document.snapshotId,
      sectionId: document.sectionId,
      blockId: document.blockId,
      source: document.source,
    },
    diagnostics: document.diagnostics,
    knownLimits: document.knownLimits,
  }));
  return resultPage({ term, filters, scored, page, limit, offset });
}

function isSearchDocument(document) {
  return document &&
    typeof document === "object" &&
    typeof document.chunkId === "string" &&
    typeof document.text === "string" &&
    Number.isInteger(document.tokenCount) &&
    document.tokenCount >= 0 &&
    document.termFrequency &&
    typeof document.termFrequency === "object" &&
    !Array.isArray(document.termFrequency) &&
    Object.values(document.termFrequency).every((count) => Number.isInteger(count) && count >= 0) &&
    document.contentTrust === CONTENT_TRUST;
}

function isSearchCorpus(corpus, documentCount) {
  return corpus &&
    typeof corpus === "object" &&
    corpus.documentCount === documentCount &&
    Number.isFinite(corpus.averageTokenCount) &&
    corpus.averageTokenCount >= 0 &&
    corpus.documentFrequency &&
    typeof corpus.documentFrequency === "object" &&
    !Array.isArray(corpus.documentFrequency) &&
    Object.values(corpus.documentFrequency).every((count) => Number.isInteger(count) && count >= 0);
}

function bm25Score(document, queryTokens, corpus) {
  const count = corpus.documentCount;
  const average = corpus.averageTokenCount || 1;
  let score = 0;
  for (const term of queryTokens) {
    const frequency = document.termFrequency[term] || 0;
    if (frequency === 0) continue;
    const containing = corpus.documentFrequency[term] || 0;
    const inverse = Math.log(1 + (count - containing + 0.5) / (containing + 0.5));
    const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * document.tokenCount / average);
    score += inverse * frequency * (BM25_K1 + 1) / denominator;
  }
  return score;
}

function resultPage({ term, filters, scored, page = [], limit, offset }) {
  const total = scored.length;
  return {
    query: term,
    filters,
    total,
    offset,
    limit,
    nextOffset: offset + page.length < total ? offset + page.length : null,
    results: page,
  };
}

function tokenize(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function frequencies(tokens) {
  const output = Object.create(null);
  for (const token of tokens) output[token] = (output[token] || 0) + 1;
  return output;
}

function matchesFilters(document, filters) {
  return Object.entries(filters).every(([key, value]) => document[key] === value);
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function makeSnippet(text, normalizedTerm, maxChars) {
  if (text.length <= maxChars) return text;
  const normalizedText = text.toLocaleLowerCase("en-US");
  const match = normalizedText.indexOf(normalizedTerm);
  const center = match === -1 ? 0 : match + Math.floor(normalizedTerm.length / 2);
  let start = Math.max(0, center - Math.floor(maxChars / 2));
  let end = Math.min(text.length, start + maxChars);
  start = Math.max(0, end - maxChars);
  const body = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function resolveChunkPath(chunksDir, relativePath) {
  if (typeof relativePath !== "string") {
    throw inputError("Chunk index contains a non-string path", { path: relativePath });
  }
  const root = path.resolve(chunksDir);
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw inputError("Chunk index path escapes the chunk directory", { path: relativePath });
  }
  return target;
}

async function validateCurrentChunkIndex(indexFile, searchIndex) {
  if (indexFile === "-" || path.basename(indexFile) !== "search-index.json") return;
  const chunkIndexPath = path.join(path.dirname(indexFile), "index.json");
  const chunkIndex = await readJson(chunkIndexPath, null);
  if (!chunkIndex) return;
  if (
    chunkIndex.artifactType !== "chunk-index" ||
    !hasValidFingerprint(chunkIndex) ||
    chunkIndex.fingerprint !== searchIndex.sourceChunkIndexFingerprint
  ) {
    throw inputError(`Search index is stale: ${indexFile}`, {
      path: indexFile,
      hint: "Run 'episteme index' to rebuild it.",
    });
  }
}
