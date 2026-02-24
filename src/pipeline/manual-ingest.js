import fs from "node:fs/promises";
import path from "node:path";
import {
  sha256Hex,
  readJson,
  writeJson,
  normalizeUrlForSnapshot,
  getExtensionFromContentType,
  nowIso,
  parseCharset,
} from "../utils.js";

const INDEX_FILE = "index.json";

export async function manualIngest({ mapPath, snapshotsDir, reuseExisting = false, refresh = false }) {
  const raw = await fs.readFile(mapPath, "utf8");
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) {
    throw new Error("Manual ingest map must be an array.");
  }

  const indexPath = path.join(snapshotsDir, INDEX_FILE);
  const index = (await readJson(indexPath, { generatedAt: null, entries: {} })) || {
    generatedAt: null,
    entries: {},
  };

  for (const entry of entries) {
    if (!entry || !entry.sourceUrl || !entry.localPath) {
      continue;
    }
    const normalizedUrl = normalizeUrlForSnapshot(entry.sourceUrl);
    const existing = index.entries[normalizedUrl];
    const buffer = await fs.readFile(entry.localPath);
    if (existing?.latest) {
      if (refresh) {
        const metaPath = path.join(snapshotsDir, existing.latest, "meta.json");
        const meta = await readJson(metaPath, null);
        if (meta?.sha256 && meta.sha256 === sha256Hex(buffer)) {
          continue;
        }
      } else if (reuseExisting) {
        continue;
      }
    }
    const fetchedAt = nowIso();
    const snapshotId = sha256Hex(Buffer.from(`${normalizedUrl}|${fetchedAt}`));
    const contentType = entry.contentType || "application/octet-stream";
    let extension = getExtensionFromContentType(contentType);
    if (extension === ".bin") {
      const ext = path.extname(entry.localPath);
      if (ext) {
        extension = ext;
      }
    }

    const snapshotDir = path.join(snapshotsDir, snapshotId);
    await fs.mkdir(snapshotDir, { recursive: true });
    const fileName = `content${extension}`;
    await fs.writeFile(path.join(snapshotDir, fileName), buffer);

    const meta = {
      snapshotId,
      sourceUrl: normalizedUrl,
      finalUrl: normalizedUrl,
      contentType,
      charset: parseCharset(contentType) || null,
      bytes: buffer.byteLength,
      sha256: sha256Hex(buffer),
      fetchedAt,
      fileName,
      manual: true,
      manualSourcePath: entry.localPath,
    };

    await writeJson(path.join(snapshotDir, "meta.json"), meta);

    const history = existing?.history ? [...existing.history] : [];
    history.push(snapshotId);
    index.entries[normalizedUrl] = {
      url: normalizedUrl,
      latest: snapshotId,
      history,
    };
  }

  index.generatedAt = nowIso();
  await writeJson(indexPath, index);
  return index;
}
