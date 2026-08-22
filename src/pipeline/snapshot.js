import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION } from "../constants.js";
import { cancelledError, inputError, limitError, throwIfAborted, unavailableError } from "../errors.js";
import { writeFileAtomic } from "../execution.js";
import {
  fingerprintJson,
  getExtensionFromContentType,
  normalizeUrlForSnapshot,
  nowIso,
  parseCharset,
  hasValidFingerprint,
  readJson,
  sha256Hex,
  withFingerprint,
  writeJson,
} from "../utils.js";

const INDEX_FILE = "index.json";
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export async function snapshotAll({
  manifest,
  outDir,
  reuseExisting = false,
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024,
  retries = 2,
  signal,
  onProgress = () => {},
}) {
  const indexPath = path.join(outDir, INDEX_FILE);
  const index = await readSnapshotIndex(indexPath);
  const results = [];

  for (const [entryIndex, entry] of manifest.entries()) {
    throwIfAborted(signal);
    const url = normalizeUrlForSnapshot(entry.url);
    onProgress({
      stage: "snapshot",
      message: `Capturing ${url}`,
      current: entryIndex + 1,
      total: manifest.length,
      status: "started",
    });
    const existing = index.entries[url] ?? null;
    const recordedSnapshot = existing?.latest
      ? await loadSnapshotContent(outDir, existing.latest)
      : null;
    if (existing?.latest && !recordedSnapshot) {
      throw inputError(`Snapshot content missing for ${url}`, {
        url,
        snapshotId: existing.latest,
      });
    }
    if (existing && (
      existing.url !== url ||
      recordedSnapshot?.meta.sourceUrl !== url
    )) {
      throw inputError(`Snapshot index source mismatch for ${url}`, {
        url,
        indexedUrl: existing.url ?? null,
        snapshotUrl: recordedSnapshot?.meta.sourceUrl ?? null,
        snapshotId: existing.latest ?? null,
      });
    }
    if (reuseExisting && existing?.latest) {
      results.push({ status: "reused", url, snapshotId: existing.latest });
      onProgress({
        stage: "snapshot",
        message: `reused: ${url}`,
        current: entryIndex + 1,
        total: manifest.length,
        status: "completed",
      });
      continue;
    }

    const previousMeta = recordedSnapshot?.meta ?? null;
    const previous = previousMeta
      ? {
          ...previousMeta,
          etag: existing.etag ?? previousMeta.etag,
          lastModified: existing.lastModified ?? previousMeta.lastModified,
        }
      : null;
    const captured = await snapshotUrl(url, outDir, {
      timeoutMs,
      maxBytes,
      retries,
      previous,
      signal,
      onProgress,
    });
    const history = existing?.history ? [...existing.history] : [];
    if (!history.includes(captured.meta.snapshotId)) {
      history.push(captured.meta.snapshotId);
    }
    index.entries[url] = {
      url,
      latest: captured.meta.snapshotId,
      history,
      etag: captured.validators.etag,
      lastModified: captured.validators.lastModified,
    };
    results.push({
      status: captured.status,
      url,
      snapshotId: captured.meta.snapshotId,
      bytes: captured.meta.bytes,
      sha256: captured.meta.sha256,
    });
    onProgress({
      stage: "snapshot",
      message: `${captured.status}: ${url}`,
      current: entryIndex + 1,
      total: manifest.length,
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

export async function snapshotUrl(url, outDir, {
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024,
  retries = 2,
  previous = null,
  signal,
  onProgress = () => {},
} = {}) {
  throwIfAborted(signal);
  const normalizedUrl = normalizeUrlForSnapshot(url);
  const headers = {
    "User-Agent": "episteme/0.1 (snapshot)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (previous?.etag) {
    headers["If-None-Match"] = previous.etag;
  } else if (previous?.lastModified) {
    headers["If-Modified-Since"] = previous.lastModified;
  }

  const request = await fetchWithRetries(normalizedUrl, {
    headers,
    timeoutMs,
    retries,
    signal,
    onProgress,
  });
  try {
    const { response } = request;
    if (response.status === 304) {
      if (!previous?.snapshotId) {
        throw unavailableError(`Source returned 304 without a recorded snapshot: ${normalizedUrl}`, {
          url: normalizedUrl,
          status: 304,
        });
      }
      const recorded = await loadSnapshotContent(outDir, previous.snapshotId);
      if (!recorded) {
        throw inputError(`Snapshot content missing for ${normalizedUrl}`, {
          url: normalizedUrl,
          snapshotId: previous.snapshotId,
        });
      }
      return {
        status: "unchanged",
        meta: recorded.meta,
        validators: {
          etag: response.headers.get("etag") || previous.etag || recorded.meta.etag || null,
          lastModified: response.headers.get("last-modified") || previous.lastModified || recorded.meta.lastModified || null,
        },
      };
    }
    if (!response.ok) {
      throw unavailableError(`Snapshot failed with HTTP ${response.status}: ${normalizedUrl}`, {
        url: normalizedUrl,
        status: response.status,
      });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = await readBoundedBody(response, maxBytes, normalizedUrl);
    const representation = {
      sourceUrl: normalizedUrl,
      finalUrl: response.url,
      contentType,
      charset: parseCharset(contentType) || null,
      bytes: buffer.byteLength,
      sha256: sha256Hex(buffer),
    };
    const snapshotId = fingerprintJson(representation);
    const snapshotDir = path.join(outDir, snapshotId);
    const existingMeta = await readJson(path.join(snapshotDir, "meta.json"), null);
    const validators = {
      etag: response.headers.get("etag") || null,
      lastModified: response.headers.get("last-modified") || null,
    };
    if (existingMeta) {
      const existingSnapshot = await loadSnapshotContent(outDir, snapshotId);
      return { status: "unchanged", meta: existingSnapshot.meta, validators };
    }

    const extension = getExtensionFromContentType(contentType);
    const fileName = `content${extension}`;
    const meta = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      snapshotId,
      ...representation,
      fetchedAt: nowIso(),
      fileName,
      ...validators,
    };
    await writeFileAtomic(path.join(snapshotDir, fileName), buffer);
    await writeJson(path.join(snapshotDir, "meta.json"), meta);
    return { status: "captured", meta, validators };
  } catch (error) {
    throwIfAborted(signal);
    if (error?.name === "AbortError") {
      throw unavailableError(`Snapshot timed out: ${normalizedUrl}`, { url: normalizedUrl }, error);
    }
    throw error;
  } finally {
    request.stopTimeout();
  }
}

export async function loadSnapshotIndex(outDir) {
  return readSnapshotIndex(path.join(outDir, INDEX_FILE), false);
}

export async function loadSnapshotMeta(outDir, snapshotId) {
  return readJson(path.join(resolveSnapshotDirectory(outDir, snapshotId), "meta.json"), null);
}

export async function loadSnapshotContent(outDir, snapshotId) {
  const meta = await loadSnapshotMeta(outDir, snapshotId);
  if (!meta) {
    return null;
  }
  if (
    meta.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    meta.snapshotId !== snapshotId ||
    !SHA256_PATTERN.test(meta.sha256 || "") ||
    typeof meta.fileName !== "string" ||
    path.basename(meta.fileName) !== meta.fileName
  ) {
    throw inputError(`Invalid snapshot metadata: ${snapshotId}`, { snapshotId });
  }
  const contentPath = path.join(resolveSnapshotDirectory(outDir, snapshotId), meta.fileName);
  let buffer;
  try {
    buffer = await fs.readFile(contentPath);
  } catch (error) {
    throw inputError(`Unable to read snapshot content: ${snapshotId}`, {
      snapshotId,
      contentPath,
    }, error);
  }
  if (
    buffer.byteLength !== meta.bytes ||
    sha256Hex(buffer) !== meta.sha256 ||
    fingerprintJson(snapshotIdentity(meta)) !== snapshotId
  ) {
    throw inputError(`Snapshot content hash mismatch: ${snapshotId}`, { snapshotId, contentPath });
  }
  return { meta, buffer };
}

async function readSnapshotIndex(indexPath, allowMissing = true) {
  const index = await readJson(indexPath, null);
  if (!index) {
    if (!allowMissing) {
      return null;
    }
    return {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactType: "snapshot-index",
      entries: {},
    };
  }
  if (
    index.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    index.artifactType !== "snapshot-index" ||
    !hasValidFingerprint(index) ||
    !index.entries ||
    typeof index.entries !== "object" ||
    Array.isArray(index.entries)
  ) {
    throw inputError(`Unsupported snapshot index contract: ${indexPath}`, { path: indexPath });
  }
  return index;
}

function snapshotIdentity(meta) {
  return {
    ...(meta.captureKind ? { captureKind: meta.captureKind } : {}),
    sourceUrl: meta.sourceUrl,
    finalUrl: meta.finalUrl,
    contentType: meta.contentType,
    charset: meta.charset,
    bytes: meta.bytes,
    sha256: meta.sha256,
  };
}

async function fetchWithRetries(url, { headers, timeoutMs, retries, signal, onProgress }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const stop = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    };
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers,
      });
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === retries) {
        return { response, stopTimeout: stop };
      }
      await response.body?.cancel();
      stop();
      onProgress({
        stage: "snapshot",
        message: `Retrying ${url} after HTTP ${response.status}`,
        current: attempt + 1,
        total: retries + 1,
        status: "retrying",
      });
      await delay(retryDelayMs(response, attempt), signal);
    } catch (error) {
      lastError = error;
      stop();
      throwIfAborted(signal);
      if (attempt === retries) {
        const reason = error?.name === "AbortError" ? "timed out" : "failed";
        throw unavailableError(`Snapshot ${reason}: ${url}`, { url, attempts: attempt + 1 }, error);
      }
      onProgress({
        stage: "snapshot",
        message: `Retrying ${url} after a transport failure`,
        current: attempt + 1,
        total: retries + 1,
        status: "retrying",
      });
      await delay(Math.min(250 * 2 ** attempt, 5_000), signal);
    }
  }
  throw unavailableError(`Snapshot failed: ${url}`, { url }, lastError);
}

async function readBoundedBody(response, maxBytes, url) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw limitError(`Source exceeds the ${maxBytes}-byte response limit: ${url}`, {
      url,
      declaredBytes: declaredLength,
      limit: maxBytes,
    });
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw limitError(`Source exceeds the ${maxBytes}-byte response limit: ${url}`, {
          url,
          observedBytes: total,
          limit: maxBytes,
        });
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/u.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, 30_000);
  }
  if (retryAfter) {
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), 30_000);
  }
  return Math.min(250 * 2 ** attempt, 5_000);
}

function delay(milliseconds, signal) {
  throwIfAborted(signal);
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(cancelledError(typeof signal.reason === "string" ? signal.reason : "SIGINT"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function countStatuses(results) {
  const counts = { captured: 0, unchanged: 0, reused: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

function resolveSnapshotDirectory(outDir, snapshotId) {
  if (typeof snapshotId !== "string" || !SHA256_PATTERN.test(snapshotId)) {
    throw inputError("Snapshot ID must be a SHA-256 fingerprint", { snapshotId });
  }
  return path.join(outDir, snapshotId);
}
