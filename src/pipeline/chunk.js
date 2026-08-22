import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION, CONTENT_TRUST, DOCUMENT_SCHEMA_VERSION } from "../constants.js";
import { inputError, throwIfAborted, usageError } from "../errors.js";
import {
  fingerprintJson,
  hasValidFingerprint,
  normalizeText,
  readJson,
  sha256Hex,
  withFingerprint,
  writeJson,
} from "../utils.js";

export async function chunkAll({
  inputDir,
  outDir,
  maxChars = 6_000,
  overlapChars = 400,
  signal,
  onProgress = () => {},
}) {
  if (overlapChars < 0 || maxChars < 1 || overlapChars >= maxChars) {
    throw usageError("Chunk overlap must be non-negative and smaller than the chunk limit");
  }
  const { documents, index: documentIndex } = await collectDocuments(inputDir, signal);
  const previousIndex = await readJson(path.join(outDir, "index.json"), null);
  if (previousIndex && (
    previousIndex.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    previousIndex.artifactType !== "chunk-index" ||
    !hasValidFingerprint(previousIndex) ||
    !Array.isArray(previousIndex.chunks)
  )) {
    throw inputError(`Invalid chunk index: ${path.join(outDir, "index.json")}`, {
      path: path.join(outDir, "index.json"),
    });
  }
  const chunkIndex = [];

  for (const [documentPosition, indexedDocument] of documents.entries()) {
    throwIfAborted(signal);
    const { document: doc, docId } = indexedDocument;
    onProgress({
      stage: "chunk",
      message: `Chunking ${doc.url}`,
      current: documentPosition + 1,
      total: documents.length,
      status: "started",
    });
    const family = doc.family || "generic";
    const baseDir = path.join(outDir, safeFamilyDirectoryName(family));

    for (const [sectionIndex, section] of doc.sections.entries()) {
      for (const [blockIndex, block] of (section.blocks || []).entries()) {
        await writeBlockChunks({
          doc,
          docId,
          family,
          baseDir,
          outDir,
          section,
          sectionIndex,
          block,
          blockIndex,
          maxChars,
          overlapChars,
          chunkIndex,
          signal,
        });
      }
    }

    for (const [formIndex, form] of (doc.pdf?.forms || []).entries()) {
      await writeBlockChunks({
        doc,
        docId,
        family,
        baseDir,
        outDir,
        section: { id: "pdf-forms", heading: form.title || "PDF form", level: 1 },
        sectionIndex: doc.sections.length,
        block: {
          id: form.id,
          type: "pdfForm",
          text: flattenPdfForm(form),
          source: form.source,
        },
        blockIndex: formIndex,
        maxChars,
        overlapChars,
        chunkIndex,
        signal,
      });
    }
    onProgress({
      stage: "chunk",
      message: `Chunked ${doc.url}`,
      current: documentPosition + 1,
      total: documents.length,
      status: "completed",
    });
  }

  chunkIndex.sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  const index = withFingerprint({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactType: "chunk-index",
    sourceDocumentIndexFingerprint: documentIndex.fingerprint,
    chunks: chunkIndex,
  });
  const indexPath = path.join(outDir, "index.json");
  await writeJson(indexPath, index);
  const maintenanceWarnings = await removeObsoleteChunks(outDir, previousIndex, index);
  return {
    indexPath,
    fingerprint: index.fingerprint,
    counts: { documents: documents.length, chunks: chunkIndex.length },
    maintenanceWarnings,
  };
}

async function writeBlockChunks({
  doc,
  docId,
  family,
  baseDir,
  outDir,
  section,
  sectionIndex,
  block,
  blockIndex,
  maxChars,
  overlapChars,
  chunkIndex,
  signal,
}) {
  const text = flattenBlock(block);
  if (!text) return;
  const parts = splitBoundedText(text, maxChars, overlapChars);
  for (const [partIndex, part] of parts.entries()) {
    throwIfAborted(signal);
    const locator = {
      url: doc.url,
      sectionId: section.id || null,
      sectionIndex,
      blockId: block?.id || null,
      blockIndex,
      partIndex,
    };
    const core = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactType: "evidence-chunk",
      contentTrust: CONTENT_TRUST,
      docId,
      url: doc.url,
      fragment: sourceFragment(block, section),
      family,
      authority: doc.authority || "informative",
      documentType: doc.documentType || null,
      sectionId: section.id || null,
      blockId: block?.id || null,
      blockType: block?.type || null,
      heading: section.heading || null,
      level: section.level || null,
      text: part.text,
      textRange: { start: part.start, end: part.end },
      part: { index: partIndex, count: parts.length },
      source: block?.source || section?.source || null,
      links: block?.links || [],
      diagnostics: doc.diagnostics || [],
      knownLimits: doc.pdf?.knownLimits || [],
      snapshotId: doc.snapshotId,
      provenance: doc.provenance,
      normativity: block?.normativity || null,
    };
    const chunkId = `chunk-${fingerprintJson({
      locator,
      text: part.text,
      sourceSha256: doc.provenance.sourceSha256,
      configurationSha256: doc.provenance.configurationSha256,
    })}`;
    const chunk = withFingerprint({ ...core, chunkId });
    const fileName = `${chunkId}.json`;
    const filePath = path.join(baseDir, fileName);
    await writeJson(filePath, chunk);
    chunkIndex.push({
      chunkId,
      docId,
      family,
      authority: chunk.authority,
      documentType: chunk.documentType,
      heading: chunk.heading,
      sectionId: chunk.sectionId,
      blockId: chunk.blockId,
      blockType: chunk.blockType,
      url: chunk.url,
      fragment: chunk.fragment,
      normativity: chunk.normativity,
      snapshotId: chunk.snapshotId,
      path: path.relative(outDir, filePath),
      textSha256: sha256Hex(Buffer.from(part.text, "utf8")),
      fingerprint: chunk.fingerprint,
    });
  }
}

function splitBoundedText(text, maxChars, overlapChars) {
  if (text.length <= maxChars) return [{ text, start: 0, end: text.length }];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const minimumBreak = start + Math.floor(maxChars * 0.6);
      const whitespace = text.lastIndexOf(" ", end);
      if (whitespace >= minimumBreak) end = whitespace;
    }
    const partText = text.slice(start, end).trim();
    if (partText) parts.push({ text: partText, start, end });
    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return parts;
}

function sourceFragment(block, section) {
  if (block?.source?.fragment) return `#${block.source.fragment}`;
  if (section?.id) return `#${section.id}`;
  return null;
}

function safeFamilyDirectoryName(family) {
  const value = String(family || "generic");
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value)) return value;
  return `family-${sha256Hex(Buffer.from(value, "utf8"))}`;
}

function flattenBlock(block) {
  if (!block) return null;
  if (block.type === "paragraph" || block.type === "note" || block.type === "code" || block.type === "pdfForm") {
    return normalizeText(block.text || "");
  }
  if (block.type === "list") {
    return normalizeText((block.items || []).join("\n"));
  }
  if (block.type === "definitionList") {
    return normalizeText((block.items || []).map((item) => `${item.term}: ${item.definition}`).join("\n"));
  }
  if (block.type === "table") {
    return normalizeText([
      (block.headers || []).join(" | "),
      ...(block.rows || []).map((row) => row.join(" | ")),
    ].filter(Boolean).join("\n"));
  }
  if (block.type === "algorithm") {
    return normalizeText((block.steps || []).map((step) => `${step.stepId}. ${step.text}`).join("\n"));
  }
  if (block.type === "grammar") {
    return normalizeText((block.productions || []).map((production) => `${production.lhs} ::= ${production.rhs}`).join("\n"));
  }
  return normalizeText(block.text || "");
}

function flattenPdfForm(form) {
  return normalizeText([
    form.title || "PDF form",
    ...(form.fields || []).map((field) => `${field.name}: ${field.value ?? "not observed"}`),
  ].join("\n"));
}

async function collectDocuments(inputDir, signal) {
  const indexPath = path.join(inputDir, "index.json");
  const index = await readJson(indexPath, null);
  if (
    index?.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    index?.artifactType !== "document-index" ||
    !hasValidFingerprint(index) ||
    !Array.isArray(index.documents)
  ) {
    throw inputError(`Invalid extracted-document index: ${indexPath}`, {
      path: indexPath,
      hint: "Run 'episteme extract' to create a document index.",
    });
  }
  const documents = [];
  const docIds = new Set();
  const paths = new Set();
  const root = path.resolve(inputDir);
  for (const entry of index.documents) {
    throwIfAborted(signal);
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
      throw inputError("Document index contains an invalid entry", { path: indexPath });
    }
    if (docIds.has(entry.docId) || paths.has(entry.path)) {
      throw inputError("Document index contains a duplicate identity or path", {
        path: indexPath,
        docId: entry.docId,
        documentPath: entry.path,
      });
    }
    docIds.add(entry.docId);
    paths.add(entry.path);
    const fullPath = path.resolve(inputDir, entry.path);
    if (fullPath === root || !fullPath.startsWith(`${root}${path.sep}`)) {
      throw inputError(`Document index path escapes the input directory: ${entry.path}`, { path: entry.path });
    }
    let raw;
    try {
      raw = await fs.readFile(fullPath);
    } catch (error) {
      throw inputError(`Unable to read indexed document: ${fullPath}`, { path: fullPath }, error);
    }
    if (sha256Hex(raw) !== entry.sha256) {
      throw inputError(`Indexed document hash mismatch: ${fullPath}`, { path: fullPath });
    }
    let document;
    try {
      document = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw inputError(`Indexed document is invalid JSON: ${fullPath}`, { path: fullPath }, error);
    }
    if (
      document?.schemaVersion !== DOCUMENT_SCHEMA_VERSION ||
      document?.contentTrust !== CONTENT_TRUST ||
      typeof document.url !== "string" ||
      typeof document.snapshotId !== "string" ||
      !Array.isArray(document.sections) ||
      typeof document.provenance?.sourceSha256 !== "string" ||
      typeof document.provenance?.configurationSha256 !== "string" ||
      entry.docId !== `document-${fingerprintJson(document)}` ||
      entry.url !== document.url ||
      entry.snapshotId !== document.snapshotId
    ) {
      throw inputError(`Invalid indexed document: ${fullPath}`, { path: fullPath });
    }
    documents.push({ docId: entry.docId, document });
  }
  documents.sort((left, right) => left.document.url.localeCompare(right.document.url));
  return { documents, index };
}

async function removeObsoleteChunks(outDir, previousIndex, currentIndex) {
  if (!previousIndex) return [];
  const retained = new Set(currentIndex.chunks.map((chunk) => chunk.path));
  const root = path.resolve(outDir);
  const warnings = [];
  for (const chunk of previousIndex.chunks || []) {
    if (!chunk || typeof chunk.path !== "string") continue;
    if (retained.has(chunk.path)) continue;
    const target = path.resolve(outDir, chunk.path);
    if (target !== root && target.startsWith(`${root}${path.sep}`)) {
      try {
        await fs.rm(target, { force: true });
      } catch (error) {
        warnings.push(`Unable to remove obsolete chunk ${chunk.path}: ${error.message}`);
      }
    }
  }
  return warnings;
}
