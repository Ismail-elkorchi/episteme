import fs from "node:fs/promises";
import path from "node:path";
import {
  sha256Hex,
  ensureDir,
  readJson,
  writeJson,
  normalizeUrlForSnapshot,
  getExtensionFromContentType,
  nowIso,
  parseCharset,
} from "../utils.js";

const INDEX_FILE = "index.json";

export async function snapshotAll({ manifest, outDir, reuseExisting = false, timeoutMs = 60000 }) {
  const indexPath = path.join(outDir, INDEX_FILE);
  const index = (await readJson(indexPath, { generatedAt: null, entries: {} })) || {
    generatedAt: null,
    entries: {},
  };

  for (const entry of manifest) {
    const normalizedUrl = normalizeUrlForSnapshot(entry.url);
    const existing = index.entries[normalizedUrl];
    if (reuseExisting && existing?.latest) {
      continue;
    }
    const snapshot = await snapshotUrl(normalizedUrl, outDir, timeoutMs);
    const history = existing?.history ? [...existing.history] : [];
    history.push(snapshot.snapshotId);
    index.entries[normalizedUrl] = {
      url: normalizedUrl,
      latest: snapshot.snapshotId,
      history,
    };
  }

  index.generatedAt = nowIso();
  await writeJson(indexPath, index);
  return index;
}

export async function snapshotUrl(url, outDir, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "episteme/0.1 (snapshot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Snapshot failed ${response.status} for ${url}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fetchedAt = nowIso();
  const snapshotId = sha256Hex(Buffer.from(`${url}|${fetchedAt}`));
  const extension = getExtensionFromContentType(contentType);

  const snapshotDir = path.join(outDir, snapshotId);
  await fs.mkdir(snapshotDir, { recursive: true });
  const fileName = `content${extension}`;
  const contentPath = path.join(snapshotDir, fileName);
  await fs.writeFile(contentPath, buffer);

  const meta = {
    snapshotId,
    sourceUrl: url,
    finalUrl: response.url,
    contentType,
    charset: parseCharset(contentType) || null,
    bytes: buffer.byteLength,
    sha256: sha256Hex(buffer),
    fetchedAt,
    fileName,
  };

  await writeJson(path.join(snapshotDir, "meta.json"), meta);
  return meta;
}

export async function loadSnapshotIndex(outDir) {
  const indexPath = path.join(outDir, INDEX_FILE);
  return readJson(indexPath, { generatedAt: null, entries: {} });
}

export async function loadSnapshotMeta(outDir, snapshotId) {
  const metaPath = path.join(outDir, snapshotId, "meta.json");
  return readJson(metaPath, null);
}

export async function loadSnapshotContent(outDir, snapshotId) {
  const meta = await loadSnapshotMeta(outDir, snapshotId);
  if (!meta) {
    return null;
  }
  const contentPath = path.join(outDir, snapshotId, meta.fileName);
  const buffer = await fs.readFile(contentPath);
  return { meta, buffer };
}
