import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION, CONTENT_TRUST, DOCUMENT_SCHEMA_VERSION } from "../constants.js";
import { inputError, throwIfAborted } from "../errors.js";
import { fingerprintJson, hasValidFingerprint, readJson, sha256Hex, withFingerprint, writeJson } from "../utils.js";

export async function diffDirectories({
  fromDir,
  toDir,
  outDir,
  includeArtifact = false,
  signal,
  onProgress = () => {},
}) {
  const [fromDocs, toDocs] = await Promise.all([
    collectDocuments(fromDir, signal),
    collectDocuments(toDir, signal),
  ]);
  const fromMap = uniqueDocuments(fromDocs, fromDir);
  const toMap = uniqueDocuments(toDocs, toDir);
  const urls = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
  const changes = [];

  for (const [urlPosition, url] of urls.entries()) {
    throwIfAborted(signal);
    onProgress({
      stage: "diff",
      message: `Comparing ${url}`,
      current: urlPosition + 1,
      total: urls.length,
      status: "started",
    });
    const previous = fromMap.get(url);
    const current = toMap.get(url);
    if (!previous) {
      changes.push({
        url,
        status: "added",
        fromSnapshot: null,
        toSnapshot: current.snapshotId,
        metadataChanged: true,
        sections: {
          added: sectionKeys(current.sections),
          removed: [],
          changed: [],
        },
      });
      continue;
    }
    if (!current) {
      changes.push({
        url,
        status: "removed",
        fromSnapshot: previous.snapshotId,
        toSnapshot: null,
        metadataChanged: true,
        sections: {
          added: [],
          removed: sectionKeys(previous.sections),
          changed: [],
        },
      });
      continue;
    }
    const sectionDiff = diffSections(previous.sections, current.sections);
    const metadataChanged = fingerprintJson(withoutSections(previous)) !== fingerprintJson(withoutSections(current));
    if (
      metadataChanged ||
      sectionDiff.added.length > 0 ||
      sectionDiff.removed.length > 0 ||
      sectionDiff.changed.length > 0
    ) {
      changes.push({
        url,
        status: "changed",
        fromSnapshot: previous.snapshotId,
        toSnapshot: current.snapshotId,
        metadataChanged,
        sections: sectionDiff,
      });
    }
  }

  const summary = summarize(changes);
  const artifact = withFingerprint({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactType: "corpus-diff",
    summary,
    documents: changes,
  });
  const outputPath = outDir ? path.join(outDir, "diff.json") : null;
  const written = outputPath ? await writeJson(outputPath, artifact) : null;
  return {
    outputPath,
    fingerprint: artifact.fingerprint,
    bytes: written?.bytes ?? Buffer.byteLength(JSON.stringify(artifact), "utf8"),
    summary,
    ...(includeArtifact ? { artifact } : {}),
  };
}

function diffSections(previousSections, currentSections) {
  const previous = indexSections(previousSections);
  const current = indexSections(currentSections);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, fingerprint] of current) {
    if (!previous.has(key)) added.push(key);
    else if (previous.get(key) !== fingerprint) changed.push(key);
  }
  for (const key of previous.keys()) {
    if (!current.has(key)) removed.push(key);
  }
  return { added, removed, changed };
}

function indexSections(sections) {
  return new Map(keyedSections(sections).map(({ key, section }) => [key, fingerprintJson(section)]));
}

function sectionKeys(sections) {
  return keyedSections(sections).map(({ key }) => key);
}

function keyedSections(sections) {
  const occurrences = new Map();
  return sections.map((section, index) => {
    const base = section.id
      ? `id:${section.id}`
      : section.heading
        ? `heading:${section.level ?? ""}:${section.heading}`
        : `anonymous:${index}`;
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    return { key: occurrence === 1 ? base : `${base}#${occurrence}`, section };
  });
}

function withoutSections(document) {
  const { sections: _ignored, ...metadata } = document;
  return metadata;
}

function summarize(changes) {
  const summary = {
    documents: { added: 0, removed: 0, changed: 0 },
    sections: { added: 0, removed: 0, changed: 0 },
  };
  for (const change of changes) {
    summary.documents[change.status] += 1;
    for (const kind of ["added", "removed", "changed"]) {
      summary.sections[kind] += change.sections[kind].length;
    }
  }
  return summary;
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
      entry.docId !== `document-${fingerprintJson(document)}` ||
      entry.url !== document.url ||
      entry.snapshotId !== document.snapshotId
    ) {
      throw inputError(`Invalid indexed document: ${fullPath}`, { path: fullPath });
    }
    documents.push(document);
  }
  return documents;
}

function uniqueDocuments(documents, directory) {
  const output = new Map();
  for (const document of documents) {
    if (output.has(document.url)) {
      throw inputError(`Duplicate extracted document URL: ${document.url}`, {
        directory,
        url: document.url,
      });
    }
    output.set(document.url, document);
  }
  return output;
}
