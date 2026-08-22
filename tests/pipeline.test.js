import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadManifest } from "../src/manifest.js";
import { loadFamilyPlugins, resolveFamily } from "../src/registry.js";
import { chunkAll } from "../src/pipeline/chunk.js";
import { diffDirectories } from "../src/pipeline/diff.js";
import { extractAll } from "../src/pipeline/extract.js";
import { buildIndex, queryIndex } from "../src/pipeline/index.js";
import { manualIngest } from "../src/pipeline/manual-ingest.js";
import { loadSnapshotContent } from "../src/pipeline/snapshot.js";
import { assertSchema } from "./helpers/schema-validator.js";

async function makeTempDir(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function documentFixture({ sections, snapshotId = "snapshot-1" }) {
  return {
    schemaVersion: "0.1",
    url: "https://example.test/document",
    title: "Document",
    family: "generic",
    authority: "informative",
    documentType: null,
    snapshotId,
    source: null,
    extractedAt: "2026-01-01T00:00:00.000Z",
    sections,
    warnings: [],
  };
}

test("loads a manifest and drops entries without URLs", async (t) => {
  const root = await makeTempDir(t, "episteme-manifest-");
  const manifestPath = path.join(root, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify([
      null,
      { label: "missing URL" },
      { url: "https://example.test/spec", extractor: "text", output: "spec" },
    ]),
  );

  assert.deepEqual(await loadManifest(manifestPath), [
    {
      url: "https://example.test/spec",
      family: null,
      authority: null,
      extractor: "text",
      output: "spec",
      label: null,
    },
  ]);
});

test("manual ingest refreshes only changed content", async (t) => {
  const root = await makeTempDir(t, "episteme-manual-ingest-");
  const sourcePath = path.join(root, "source.txt");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const sourceUrl = "https://example.test/manual.txt";

  await fs.writeFile(sourcePath, "first version", "utf8");
  await fs.writeFile(mapPath, JSON.stringify([{ sourceUrl, localPath: sourcePath }]), "utf8");

  const initial = await manualIngest({ mapPath, snapshotsDir });
  const initialEntry = initial.entries[sourceUrl];
  assert.equal(initialEntry.history.length, 1);

  const unchanged = await manualIngest({ mapPath, snapshotsDir, refresh: true });
  assert.deepEqual(unchanged.entries[sourceUrl].history, initialEntry.history);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(sourcePath, "second version", "utf8");
  const changed = await manualIngest({ mapPath, snapshotsDir, refresh: true });
  assert.equal(changed.entries[sourceUrl].history.length, 2);
  assert.notEqual(changed.entries[sourceUrl].latest, initialEntry.latest);

  const snapshot = await loadSnapshotContent(snapshotsDir, changed.entries[sourceUrl].latest);
  assert.equal(snapshot.buffer.toString("utf8"), "second version");
});

test("runs the offline extract, chunk, index, and query pipeline", async (t) => {
  const root = await makeTempDir(t, "episteme-pipeline-");
  const sourcePath = path.join(root, "source.html");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/spec";

  await fs.writeFile(
    sourcePath,
    "<!doctype html><title>Fixture</title><main><h1 id=entry>Entry</h1><p>Searchable knowledge.</p></main>",
    "utf8",
  );
  await fs.writeFile(
    mapPath,
    JSON.stringify([{ sourceUrl, localPath: sourcePath, contentType: "text/html; charset=utf-8" }]),
    "utf8",
  );
  await manualIngest({ mapPath, snapshotsDir });

  const plugins = await loadFamilyPlugins();
  const manifest = [{ url: sourceUrl, family: "generic", output: "document" }];
  await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    plugins: {
      list: plugins,
      resolve: (url, explicit) => resolveFamily(plugins, url, explicit),
    },
  });

  const extracted = JSON.parse(await fs.readFile(path.join(specsDir, "document.json"), "utf8"));
  await assertSchema(extracted, "offline-pipeline-document");
  assert.equal(extracted.sections[0].heading, "Entry");

  await chunkAll({ inputDir: specsDir, outDir: chunksDir });
  const indexFile = path.join(chunksDir, "search-index.json");
  await buildIndex({ chunksDir, outFile: indexFile });

  const results = await queryIndex({ indexFile, term: "searchable", family: "generic" });
  assert.equal(results.length, 1);
  assert.equal(results[0].heading, "Entry");
  assert.deepEqual(await queryIndex({ indexFile, term: "searchable", family: "w3c" }), []);
});

test("preserves PDF provenance and known limits through the offline pipeline", async (t) => {
  const root = await makeTempDir(t, "episteme-pdf-pipeline-");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/minimal.pdf";
  const localPath = fileURLToPath(new URL("./fixtures/minimal.pdf", import.meta.url));

  await fs.writeFile(
    mapPath,
    JSON.stringify([{ sourceUrl, localPath, contentType: "application/pdf" }]),
    "utf8",
  );
  await manualIngest({ mapPath, snapshotsDir });

  const plugins = await loadFamilyPlugins();
  await extractAll({
    manifest: [{ url: sourceUrl, family: "generic", extractor: "pdf", output: "document" }],
    snapshotsDir,
    outDir: specsDir,
    plugins: {
      list: plugins,
      resolve: (url, explicit) => resolveFamily(plugins, url, explicit),
    },
  });

  const extracted = JSON.parse(await fs.readFile(path.join(specsDir, "document.json"), "utf8"));
  await assertSchema(extracted, "offline-pdf-document");
  assert.equal(extracted.extractedAt, extracted.source.fetchedAt);
  assert.deepEqual(extracted.sections[0].blocks[0].source.pageNumbers, [1]);

  await chunkAll({ inputDir: specsDir, outDir: chunksDir });
  const chunkIndex = JSON.parse(await fs.readFile(path.join(chunksDir, "index.json"), "utf8"));
  const chunk = JSON.parse(
    await fs.readFile(path.join(chunksDir, chunkIndex.chunks[0].path), "utf8"),
  );
  assert.deepEqual(chunk.source.pageNumbers, [1]);
  assert.deepEqual(chunk.knownLimits, extracted.pdf.knownLimits);
  assert.deepEqual(chunk.diagnostics, extracted.diagnostics);
});

test("reports added, removed, and changed sections", async (t) => {
  const root = await makeTempDir(t, "episteme-diff-");
  const fromDir = path.join(root, "from");
  const toDir = path.join(root, "to");
  const outDir = path.join(root, "diff");
  await fs.mkdir(fromDir);
  await fs.mkdir(toDir);

  const paragraph = (id, text) => ({
    id,
    heading: id,
    level: 1,
    blocks: [{ type: "paragraph", text }],
  });
  await fs.writeFile(
    path.join(fromDir, "document.json"),
    JSON.stringify(documentFixture({ sections: [paragraph("changed", "old"), paragraph("removed", "gone")] })),
  );
  await fs.writeFile(
    path.join(toDir, "document.json"),
    JSON.stringify(
      documentFixture({
        snapshotId: "snapshot-2",
        sections: [paragraph("changed", "new"), paragraph("added", "here")],
      }),
    ),
  );

  await diffDirectories({ fromDir, toDir, outDir });
  const diff = JSON.parse(
    await fs.readFile(path.join(outDir, "example-test-document.diff.json"), "utf8"),
  );
  assert.deepEqual(diff.summary, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(diff.added, ["added"]);
  assert.deepEqual(diff.removed, ["removed"]);
  assert.deepEqual(diff.changed, ["changed"]);
});
