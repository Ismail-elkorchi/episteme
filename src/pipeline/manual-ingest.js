import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION } from "../constants.js";
import { EpistemeError, inputError, limitError, throwIfAborted } from "../errors.js";
import { readJsonInput, writeFileAtomic } from "../execution.js";
import { loadSnapshotContent } from "./snapshot.js";
import {
  fingerprintJson,
  getExtensionFromContentType,
  normalizeUrlForSnapshot,
  nowIso,
  parseCharset,
  readJson,
  sha256Hex,
  hasValidFingerprint,
  withFingerprint,
  writeJson,
} from "../utils.js";

const INDEX_FILE = "index.json";
const ALLOWED_KEYS = new Set(["sourceUrl", "localPath", "contentType"]);

export async function manualIngest({
  mapPath,
  snapshotsDir,
  maxBytes = 25 * 1024 * 1024,
  maxSources = 1_000,
  maxInputBytes = 64 * 1024 * 1024,
  stdin = process.stdin,
  signal,
  onProgress = () => {},
}) {
  const entries = await loadManualMap(mapPath, maxSources, maxInputBytes, stdin, signal);
  const indexPath = path.join(snapshotsDir, INDEX_FILE);
  const existingIndex = await readJson(indexPath, null);
  if (existingIndex && (
    existingIndex.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    existingIndex.artifactType !== "snapshot-index" ||
    !hasValidFingerprint(existingIndex) ||
    !existingIndex.entries ||
    typeof existingIndex.entries !== "object" ||
    Array.isArray(existingIndex.entries)
  )) {
    throw inputError(`Unsupported snapshot index contract: ${indexPath}`, { path: indexPath });
  }
  const index = existingIndex ?? {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactType: "snapshot-index",
    entries: {},
  };
  const results = [];

  for (const [entryIndex, entry] of entries.entries()) {
    throwIfAborted(signal);
    onProgress({
      stage: "manual-ingest",
      message: `Reading ${entry.sourceUrl}`,
      current: entryIndex + 1,
      total: entries.length,
      status: "started",
    });
    const buffer = await readBoundedManualSource(entry.localPath, maxBytes, signal);
    const normalizedUrl = normalizeUrlForSnapshot(entry.sourceUrl);
    const contentType = entry.contentType || "application/octet-stream";
    const representation = {
      captureKind: "manual",
      sourceUrl: normalizedUrl,
      finalUrl: normalizedUrl,
      contentType,
      charset: parseCharset(contentType) || null,
      bytes: buffer.byteLength,
      sha256: sha256Hex(buffer),
    };
    const snapshotId = fingerprintJson(representation);
    const snapshotDir = path.join(snapshotsDir, snapshotId);
    const metaPath = path.join(snapshotDir, "meta.json");
    let meta = await readJson(metaPath, null);
    let status = "unchanged";
    if (meta) {
      meta = (await loadSnapshotContent(snapshotsDir, snapshotId)).meta;
    } else {
      let extension = getExtensionFromContentType(contentType);
      if (extension === ".bin") extension = path.extname(entry.localPath) || extension;
      const fileName = `content${extension}`;
      meta = {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        snapshotId,
        ...representation,
        fetchedAt: nowIso(),
        fileName,
        etag: null,
        lastModified: null,
      };
      await writeFileAtomic(path.join(snapshotDir, fileName), buffer);
      await writeJson(metaPath, meta);
      status = "captured";
    }

    const previous = index.entries[normalizedUrl];
    const history = previous?.history ? [...previous.history] : [];
    if (!history.includes(snapshotId)) history.push(snapshotId);
    index.entries[normalizedUrl] = { url: normalizedUrl, latest: snapshotId, history };
    results.push({
      status,
      url: normalizedUrl,
      snapshotId,
      bytes: meta.bytes,
      sha256: meta.sha256,
    });
    onProgress({
      stage: "manual-ingest",
      message: `${status}: ${normalizedUrl}`,
      current: entryIndex + 1,
      total: entries.length,
      status: "completed",
    });
  }

  const completedIndex = withFingerprint(index);
  await writeJson(indexPath, completedIndex);
  return {
    indexPath,
    fingerprint: completedIndex.fingerprint,
    counts: countStatuses(results),
    sources: results,
  };
}

async function loadManualMap(mapPath, maxSources, maxInputBytes, stdin, signal) {
  const entries = await readJsonInput(mapPath, {
    maxBytes: maxInputBytes,
    stdin,
    label: "Manual-ingest map",
    signal,
  });
  if (!Array.isArray(entries)) {
    throw inputError("Manual-ingest map must be a JSON array", { path: mapPath });
  }
  if (entries.length > maxSources) {
    throw limitError(`Manual-ingest map contains ${entries.length} sources; limit is ${maxSources}`, {
      path: mapPath,
      actual: entries.length,
      limit: maxSources,
    });
  }
  const seen = new Set();
  return entries.map((entry, index) => {
    const validated = validateMapEntry(entry, index, mapPath);
    const sourceUrl = normalizeUrlForSnapshot(validated.sourceUrl);
    if (seen.has(sourceUrl)) {
      throw inputError(`Manual-ingest map contains duplicate sourceUrl: ${sourceUrl}`, {
        path: mapPath,
        index,
      });
    }
    seen.add(sourceUrl);
    return { ...validated, sourceUrl };
  });
}

function validateMapEntry(entry, index, mapPath) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw inputError(`Manual-ingest entry ${index} must be an object`, { path: mapPath, index });
  }
  const unknown = Object.keys(entry).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length > 0) {
    throw inputError(`Manual-ingest entry ${index} has unknown fields: ${unknown.join(", ")}`, {
      path: mapPath,
      index,
      fields: unknown,
    });
  }
  if (
    typeof entry.sourceUrl !== "string" || entry.sourceUrl.length === 0 ||
    typeof entry.localPath !== "string" || entry.localPath.length === 0
  ) {
    throw inputError(`Manual-ingest entry ${index} requires non-empty sourceUrl and localPath strings`, {
      path: mapPath,
      index,
    });
  }
  let url;
  try {
    url = new URL(entry.sourceUrl);
  } catch (error) {
    throw inputError(`Manual-ingest entry ${index} has an invalid sourceUrl`, {
      path: mapPath,
      index,
    }, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw inputError(`Manual-ingest entry ${index} sourceUrl must use HTTP or HTTPS`, {
      path: mapPath,
      index,
    });
  }
  if (entry.contentType !== undefined && (
    typeof entry.contentType !== "string" || entry.contentType.length === 0
  )) {
    throw inputError(`Manual-ingest entry ${index} contentType must be a non-empty string`, {
      path: mapPath,
      index,
    });
  }
  return { ...entry, sourceUrl: url.toString() };
}

async function readBoundedManualSource(localPath, maxBytes, signal) {
  let handle;
  try {
    handle = await fs.open(localPath, "r");
  } catch (error) {
    throw inputError(`Unable to read local source: ${localPath}`, { path: localPath }, error);
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw inputError(`Local source is not a regular file: ${localPath}`, { path: localPath });
    }
    if (stats.size > maxBytes) {
      throw localLimitError(localPath, stats.size, maxBytes);
    }
    const chunks = [];
    let total = 0;
    const scratch = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
    while (total <= maxBytes) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        scratch,
        0,
        Math.min(scratch.length, maxBytes + 1 - total),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw localLimitError(localPath, total, maxBytes);
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof EpistemeError) throw error;
    throw inputError(`Unable to read local source: ${localPath}`, { path: localPath }, error);
  } finally {
    await handle.close();
  }
}

function localLimitError(localPath, bytes, limit) {
  return limitError(`Local source exceeds the ${limit}-byte limit: ${localPath}`, {
    path: localPath,
    bytes,
    limit,
  });
}

function countStatuses(results) {
  const counts = { captured: 0, unchanged: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}
