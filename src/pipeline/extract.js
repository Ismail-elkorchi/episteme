import fs from "node:fs/promises";
import path from "node:path";
import { extractHtmlDocument } from "../extractors/html.js";
import { resolveHtmlEngine } from "../extractors/html-engine/index.js";
import { extractTextDocument } from "../extractors/text.js";
import { extractPdfDocument } from "../extractors/pdf.js";
import { extractXmlDocument } from "../extractors/xml.js";
import { loadSnapshotIndex, loadSnapshotContent } from "./snapshot.js";
import { extractFragment, sanitizeUrlToId, normalizeText, writeJson, ensureDir } from "../utils.js";

let htmlEnginePromise = null;

export async function extractAll({ manifest, snapshotsDir, outDir, format = "json", plugins }) {
  const index = await loadSnapshotIndex(snapshotsDir);
  if (!index || !index.entries) {
    throw new Error(`Snapshot index missing in ${snapshotsDir}`);
  }

  for (const entry of manifest) {
    const sourceUrl = entry.url;
    const normalizedUrl = new URL(sourceUrl);
    normalizedUrl.hash = "";
    const snapshotEntry = index.entries[normalizedUrl.toString()];
    if (!snapshotEntry?.latest) {
      throw new Error(`No snapshot for ${sourceUrl}`);
    }
    const snapshotId = snapshotEntry.latest;
    const snapshot = await loadSnapshotContent(snapshotsDir, snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot content missing for ${sourceUrl}`);
    }
    const plugin = plugins.resolve(sourceUrl, entry.family);
    const authority = entry.authority || plugin.authority || "informative";
    const familyId = plugin.id;
    const fragment = extractFragment(sourceUrl);
    const extractorId = entry.extractor || plugin.extractor || "html";

    const documentData = await extractFromSnapshot({
      snapshot,
      plugin,
      extractorId,
      sourceUrl,
      familyId,
      authority,
      fragment,
    });

    const finalDoc = fragment ? filterByFragment(documentData, fragment) : documentData;
    finalDoc.authority = authority;

    const outputPath = resolveOutputPath(outDir, sourceUrl, entry.output, familyId, format);
    await ensureDir(outputPath);
    if (format === "md") {
      const { renderMarkdown } = await import("../render.js");
      const output = renderMarkdown(finalDoc);
      await fs.writeFile(outputPath, output, "utf8");
    } else {
      await writeJson(outputPath, finalDoc);
    }
  }
}

function resolveOutputPath(outDir, url, outputOverride, familyId, format) {
  if (outputOverride) {
    const fileName = outputOverride.endsWith(`.${format}`)
      ? outputOverride
      : `${outputOverride}.${format}`;
    return path.isAbsolute(fileName) ? fileName : path.join(outDir, fileName);
  }
  const slug = sanitizeUrlToId(url);
  return path.join(outDir, familyId, `${slug}.${format}`);
}

async function extractFromSnapshot({
  snapshot,
  plugin,
  extractorId,
  sourceUrl,
  familyId,
  authority,
  fragment,
}) {
  const contentType = snapshot.meta.contentType || "";
  if (extractorId === "html") {
    if (!contentType.includes("text/html")) {
      return unsupportedSnapshot({ snapshot, sourceUrl, familyId, authority, plugin });
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
      dom,
      htmlEngine,
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
    });
    if (fragment) {
      documentData.fragment = fragment;
    }
    return documentData;
  }

  return unsupportedSnapshot({ snapshot, sourceUrl, familyId, authority, plugin, extractorId });
}

async function getHtmlEngine() {
  if (!htmlEnginePromise) {
    htmlEnginePromise = resolveHtmlEngine();
  }
  return htmlEnginePromise;
}

function unsupportedSnapshot({ snapshot, sourceUrl, familyId, authority, plugin, extractorId }) {
  return {
    schemaVersion: "0.2",
    url: sourceUrl,
    title: sourceUrl,
    family: familyId,
    authority,
    documentType: plugin.documentType || null,
    snapshotId: snapshot.meta.snapshotId,
    source: snapshot.meta,
    extractedAt: new Date().toISOString(),
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
