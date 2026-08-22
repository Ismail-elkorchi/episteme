import fs from "node:fs/promises";
import path from "node:path";
import { extractHtmlDocument } from "../extractors/html.js";
import { resolveHtmlEngine } from "../extractors/html-engine/index.js";
import { extractTextDocument } from "../extractors/text.js";
import { extractPdfDocument } from "../extractors/pdf.js";
import { extractXmlDocument } from "../extractors/xml.js";
import { loadSnapshotIndex, loadSnapshotContent } from "./snapshot.js";
import { ARTIFACT_SCHEMA_VERSION } from "../constants.js";
import { createExtractionProvenance, documentBase } from "../document.js";
import { inputError, processingError, throwIfAborted } from "../errors.js";
import {
  extractFragment,
  normalizeText,
  writeJson,
  sha256Hex,
  fingerprintJson,
  hasValidFingerprint,
  readJson,
  withFingerprint,
} from "../utils.js";

let htmlEnginePromise = null;

export async function extractAll({
  manifest,
  snapshotsDir,
  outDir,
  resolvePlugin,
  signal,
  onProgress = () => {},
}) {
  const index = await loadSnapshotIndex(snapshotsDir);
  if (!index || !index.entries) {
    throw inputError(`Snapshot index missing in ${snapshotsDir}`, { path: snapshotsDir });
  }
  const outputIndexPath = path.join(outDir, "index.json");
  const previousIndex = await readJson(outputIndexPath, null);
  if (previousIndex && (
    previousIndex.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    previousIndex.artifactType !== "document-index" ||
    !hasValidFingerprint(previousIndex) ||
    !Array.isArray(previousIndex.documents)
  )) {
    throw inputError(`Invalid extracted-document index: ${outputIndexPath}`, { path: outputIndexPath });
  }
  const documents = [];

  for (const [entryIndex, entry] of manifest.entries()) {
    throwIfAborted(signal);
    const sourceUrl = entry.url;
    onProgress({
      stage: "extract",
      message: `Extracting ${sourceUrl}`,
      current: entryIndex + 1,
      total: manifest.length,
      status: "started",
    });
    const normalizedUrl = new URL(sourceUrl);
    normalizedUrl.hash = "";
    const snapshotEntry = index.entries[normalizedUrl.toString()];
    if (!snapshotEntry?.latest) {
      throw inputError(`No snapshot for ${sourceUrl}`, { url: sourceUrl });
    }
    const snapshotId = snapshotEntry.latest;
    const snapshot = await loadSnapshotContent(snapshotsDir, snapshotId);
    if (!snapshot) {
      throw inputError(`Snapshot content missing for ${sourceUrl}`, {
        url: sourceUrl,
        snapshotId,
      });
    }
    const plugin = resolvePlugin(sourceUrl, entry.family);
    const authority = entry.authority || plugin.authority || "informative";
    const familyId = plugin.id;
    const fragment = extractFragment(sourceUrl);
    const extractorId = entry.extractor || plugin.extractor || "html";
    const provenance = createExtractionProvenance({
      source: snapshot.meta,
      extractor: extractorId,
      family: familyId,
      authority,
      documentType: plugin.documentType || null,
      rules: plugin.rules,
      fragment,
    });

    let documentData;
    try {
      documentData = await extractFromSnapshot({
        snapshot,
        plugin,
        extractorId,
        sourceUrl,
        familyId,
        authority,
        fragment,
        provenance,
      });
    } catch (error) {
      throw processingError(`Extraction failed for ${sourceUrl}`, {
        url: sourceUrl,
        snapshotId,
        extractor: extractorId,
      }, error);
    }

    const finalDoc = fragment ? filterByFragment(documentData, fragment) : documentData;
    finalDoc.authority = authority;

    const docId = `document-${fingerprintJson(finalDoc)}`;
    const outputPath = resolveOutputPath(outDir, familyId, docId);
    const written = await writeJson(outputPath, finalDoc);
    documents.push({
      url: sourceUrl,
      docId,
      snapshotId,
      extractor: extractorId,
      family: familyId,
      outputPath,
      bytes: written.bytes,
      sha256: written.sha256,
      warnings: finalDoc.warnings || [],
      path: path.relative(outDir, outputPath),
    });
    onProgress({
      stage: "extract",
      message: `Extracted ${sourceUrl}`,
      current: entryIndex + 1,
      total: manifest.length,
      status: "completed",
    });
  }
  documents.sort((left, right) => left.url.localeCompare(right.url));
  const completedIndex = withFingerprint({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactType: "document-index",
    documents: documents.map((document) => ({
      docId: document.docId,
      url: document.url,
      snapshotId: document.snapshotId,
      extractor: document.extractor,
      family: document.family,
      path: document.path,
      bytes: document.bytes,
      sha256: document.sha256,
    })),
  });
  await writeJson(outputIndexPath, completedIndex);
  const maintenanceWarnings = await removeObsoleteDocuments(outDir, previousIndex, completedIndex);
  return {
    indexPath: outputIndexPath,
    fingerprint: completedIndex.fingerprint,
    counts: {
      documents: documents.length,
      warnings: documents.reduce((total, document) => total + document.warnings.length, 0),
    },
    documents,
    maintenanceWarnings,
  };
}

function resolveOutputPath(outDir, familyId, docId) {
  const familyDirectory = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(familyId)
    ? familyId
    : `family-${sha256Hex(Buffer.from(familyId, "utf8"))}`;
  return path.join(outDir, familyDirectory, `${docId}.json`);
}

async function removeObsoleteDocuments(outDir, previousIndex, currentIndex) {
  if (!previousIndex) return [];
  const retained = new Set(currentIndex.documents.map((document) => document.path));
  const root = path.resolve(outDir);
  const warnings = [];
  for (const document of previousIndex.documents || []) {
    if (!document || typeof document.path !== "string") continue;
    if (retained.has(document.path)) continue;
    const target = path.resolve(outDir, document.path);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) continue;
    try {
      await fs.rm(target, { force: true });
    } catch (error) {
      warnings.push(`Unable to remove obsolete document ${document.path}: ${error.message}`);
    }
  }
  return warnings;
}

async function extractFromSnapshot({
  snapshot,
  plugin,
  extractorId,
  sourceUrl,
  familyId,
  authority,
  fragment,
  provenance,
}) {
  const contentType = snapshot.meta.contentType || "";
  if (extractorId === "html") {
    if (!contentType.includes("text/html")) {
      return unsupportedSnapshot({
        snapshot,
        sourceUrl,
        familyId,
        authority,
        plugin,
        extractorId,
        provenance,
      });
    }
    const { html, warning } = decodeHtmlSnapshot(snapshot);
    const htmlEngine = await getHtmlEngine();
    const dom = htmlEngine.parse({ html, url: sourceUrl });
    const documentData = extractHtmlDocument({
      rules: plugin.rules,
      url: sourceUrl,
      family: familyId,
      authority,
      documentType: plugin.documentType || null,
      snapshotId: snapshot.meta.snapshotId,
      source: snapshot.meta,
      provenance,
      dom,
    });
    if (warning) {
      documentData.warnings = [...(documentData.warnings || []), warning];
    }
    if (fragment) {
      documentData.fragment = fragment;
    }
    return documentData;
  }

  if (extractorId === "xml") {
    const { text, warning } = decodeTextSnapshot(snapshot);
    const documentData = extractXmlDocument({
      text,
      url: sourceUrl,
      family: familyId,
      authority,
      documentType: plugin.documentType || null,
      snapshotId: snapshot.meta.snapshotId,
      source: snapshot.meta,
      provenance,
    });
    if (warning) {
      documentData.warnings = [...(documentData.warnings || []), warning];
    }
    if (fragment) {
      documentData.fragment = fragment;
    }
    return documentData;
  }

  if (extractorId === "text") {
    const { text, warning } = decodeTextSnapshot(snapshot);
    const documentData = extractTextDocument({
      text,
      url: sourceUrl,
      family: familyId,
      authority,
      documentType: plugin.documentType || null,
      snapshotId: snapshot.meta.snapshotId,
      source: snapshot.meta,
      provenance,
    });
    if (warning) {
      documentData.warnings = [...(documentData.warnings || []), warning];
    }
    if (fragment) {
      documentData.fragment = fragment;
    }
    return documentData;
  }

  if (extractorId === "pdf") {
    const documentData = await extractPdfDocument({
      buffer: snapshot.buffer,
      url: sourceUrl,
      family: familyId,
      authority,
      documentType: plugin.documentType || null,
      snapshotId: snapshot.meta.snapshotId,
      source: snapshot.meta,
      provenance,
    });
    if (fragment) {
      documentData.fragment = fragment;
    }
    return documentData;
  }

  return unsupportedSnapshot({
    snapshot,
    sourceUrl,
    familyId,
    authority,
    plugin,
    extractorId,
    provenance,
  });
}

async function getHtmlEngine() {
  if (!htmlEnginePromise) {
    htmlEnginePromise = resolveHtmlEngine();
  }
  return htmlEnginePromise;
}

function unsupportedSnapshot({
  snapshot,
  sourceUrl,
  familyId,
  authority,
  plugin,
  extractorId,
  provenance,
}) {
  return {
    ...documentBase({
      url: sourceUrl,
      title: sourceUrl,
      family: familyId,
      authority,
      documentType: plugin.documentType,
      snapshotId: snapshot.meta.snapshotId,
      source: snapshot.meta,
      provenance,
    }),
    sections: [],
    warnings: [
      `Unsupported content type for extractor "${extractorId || plugin.extractor || "html"}"`,
    ],
  };
}

function decodeHtmlSnapshot(snapshot) {
  const charset = snapshot.meta.charset || "utf8";
  try {
    return { html: snapshot.buffer.toString(charset), warning: null };
  } catch (error) {
    return {
      html: snapshot.buffer.toString("utf8"),
      warning: `Unsupported charset "${charset}", decoded as utf8`,
    };
  }
}

function decodeTextSnapshot(snapshot) {
  const charset = snapshot.meta.charset || "utf8";
  try {
    return { text: snapshot.buffer.toString(charset), warning: null };
  } catch (error) {
    return {
      text: snapshot.buffer.toString("utf8"),
      warning: `Unsupported charset "${charset}", decoded as utf8`,
    };
  }
}

function filterByFragment(documentData, fragment) {
  const normalizedFragment = fragment.replace(/^#/, "");
  const matchedSections = documentData.sections.filter((section) => section.id === normalizedFragment);
  if (matchedSections.length > 0) {
    return {
      ...documentData,
      sections: matchedSections.map((section) => ({
        ...section,
        heading: section.heading || normalizeText(section.id || ""),
      })),
    };
  }

  for (const section of documentData.sections) {
    const matchedBlocks = (section.blocks || []).filter((block) => {
      if (block?.id === normalizedFragment) {
        return true;
      }
      if (block?.source?.fragment === normalizedFragment) {
        return true;
      }
      return false;
    });
    if (matchedBlocks.length > 0) {
      return {
        ...documentData,
        sections: [
          {
            ...section,
            blocks: matchedBlocks,
          },
        ],
      };
    }
  }

  return {
    ...documentData,
    warnings: [...(documentData.warnings || []), `Fragment not found: ${normalizedFragment}`],
  };
}
