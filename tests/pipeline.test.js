import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadManifest } from "../src/manifest.js";
import { loadFamilyPlugins, resolveFamily } from "../src/registry.js";
import { chunkAll } from "../src/pipeline/chunk.js";
import { diffDirectories } from "../src/pipeline/diff.js";
import { extractAll } from "../src/pipeline/extract.js";
import { buildIndex, queryIndex } from "../src/pipeline/index.js";
import { manualIngest } from "../src/pipeline/manual-ingest.js";
import { loadSnapshotContent, snapshotAll } from "../src/pipeline/snapshot.js";
import { fingerprintJson, withFingerprint, writeJson } from "../src/utils.js";
import { assertArtifact, assertSchema } from "./helpers/schema-validator.js";
import { extractionFixture } from "./helpers/extraction-fixture.js";

async function makeTempDir(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function pluginResolver(plugins) {
  return (url, family) => resolveFamily(plugins, url, family);
}

function documentFixture({ url, content, sections }) {
  const context = extractionFixture({
    url,
    content,
    contentType: "text/plain; charset=utf-8",
    extractor: "text",
  });
  return {
    schemaVersion: "1",
    contentTrust: "untrusted-source",
    url,
    title: "Document",
    family: "generic",
    authority: "informative",
    documentType: null,
    ...context,
    sections,
    warnings: [],
  };
}

async function writeDocumentCorpus(directory, documents) {
  const entries = [];
  for (const document of documents) {
    const docId = `document-${fingerprintJson(document)}`;
    const relativePath = path.join("generic", `${docId}.json`);
    const written = await writeJson(path.join(directory, relativePath), document);
    entries.push({
      docId,
      url: document.url,
      snapshotId: document.snapshotId,
      extractor: document.provenance.extractor,
      family: document.family,
      path: relativePath,
      bytes: written.bytes,
      sha256: written.sha256,
    });
  }
  entries.sort((left, right) => left.url.localeCompare(right.url));
  const index = withFingerprint({
    schemaVersion: "1",
    artifactType: "document-index",
    documents: entries,
  });
  await writeJson(path.join(directory, "index.json"), index);
  return index;
}

test("rejects malformed and unknown manifest entries", async (t) => {
  const root = await makeTempDir(t, "episteme-manifest-");
  const manifestPath = path.join(root, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify([{ url: "https://example.test/spec", label: "dead" }]));
  await assert.rejects(loadManifest(manifestPath), (error) => error.code === "INVALID_INPUT");

  await fs.writeFile(
    manifestPath,
    JSON.stringify([{ url: "https://example.test/spec", extractor: "text" }]),
  );
  assert.deepEqual(await loadManifest(manifestPath), [{
    url: "https://example.test/spec",
    family: null,
    authority: null,
    extractor: "text",
  }]);
});

test("accepts bounded manifest input from stdin", async () => {
  const payload = JSON.stringify([{ url: "https://example.test/stdin", extractor: "text" }]);
  assert.deepEqual(await loadManifest("-", {
    stdin: Readable.from([payload]),
    maxInputBytes: Buffer.byteLength(payload),
  }), [{
    url: "https://example.test/stdin",
    family: null,
    authority: null,
    extractor: "text",
  }]);
  await assert.rejects(
    loadManifest("-", { stdin: Readable.from([payload]), maxInputBytes: 8 }),
    (error) => error.code === "LIMIT_EXCEEDED",
  );
});

test("manual ingest is content-addressed and idempotent", async (t) => {
  const root = await makeTempDir(t, "episteme-manual-ingest-");
  const sourcePath = path.join(root, "source.txt");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const sourceUrl = "https://example.test/manual.txt";
  await fs.writeFile(sourcePath, "first version", "utf8");
  await fs.writeFile(mapPath, JSON.stringify([{ sourceUrl, localPath: sourcePath }]), "utf8");

  const initial = await manualIngest({ mapPath, snapshotsDir });
  assert.deepEqual(initial.counts, { captured: 1, unchanged: 0 });
  const initialId = initial.sources[0].snapshotId;

  const unchanged = await manualIngest({ mapPath, snapshotsDir });
  assert.deepEqual(unchanged.counts, { captured: 0, unchanged: 1 });
  assert.equal(unchanged.sources[0].snapshotId, initialId);
  assert.equal(unchanged.fingerprint, initial.fingerprint);

  const recorded = await loadSnapshotContent(snapshotsDir, initialId);
  const recordedPath = path.join(snapshotsDir, initialId, recorded.meta.fileName);
  await fs.writeFile(recordedPath, "tampered content", "utf8");
  await assert.rejects(
    manualIngest({ mapPath, snapshotsDir }),
    (error) => error.code === "INVALID_INPUT" && /hash mismatch/u.test(error.message),
  );
  await fs.writeFile(recordedPath, "first version", "utf8");

  await fs.writeFile(sourcePath, "second version", "utf8");
  const changed = await manualIngest({ mapPath, snapshotsDir });
  assert.notEqual(changed.sources[0].snapshotId, initialId);
  const snapshot = await loadSnapshotContent(snapshotsDir, changed.sources[0].snapshotId);
  assert.equal(snapshot.buffer.toString("utf8"), "second version");

  await fs.writeFile(
    mapPath,
    JSON.stringify([
      { sourceUrl, localPath: sourcePath },
      { sourceUrl: `${sourceUrl}#duplicate`, localPath: sourcePath },
    ]),
    "utf8",
  );
  await assert.rejects(
    manualIngest({ mapPath, snapshotsDir }),
    (error) => error.code === "INVALID_INPUT" && /duplicate sourceUrl/u.test(error.message),
  );
});

test("failed and cancelled corpus updates preserve the previous committed indexes", async (t) => {
  const root = await makeTempDir(t, "episteme-transaction-");
  const sourcePath = path.join(root, "source.txt");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/transaction";
  await fs.writeFile(sourcePath, "Committed evidence remains readable.", "utf8");
  await fs.writeFile(mapPath, JSON.stringify([{
    sourceUrl,
    localPath: sourcePath,
    contentType: "text/plain; charset=utf-8",
  }]));
  await manualIngest({ mapPath, snapshotsDir });
  const plugins = await loadFamilyPlugins();
  const manifest = [{ url: sourceUrl, family: "generic", authority: null, extractor: "text" }];
  await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: pluginResolver(plugins),
  });
  const committedDocuments = await fs.readFile(path.join(specsDir, "index.json"));

  await assert.rejects(
    extractAll({
      manifest: [...manifest, {
        url: "https://example.test/missing",
        family: "generic",
        authority: null,
        extractor: "text",
      }],
      snapshotsDir,
      outDir: specsDir,
      resolvePlugin: pluginResolver(plugins),
    }),
    (error) => error.code === "INVALID_INPUT" && /No snapshot/u.test(error.message),
  );
  assert.deepEqual(await fs.readFile(path.join(specsDir, "index.json")), committedDocuments);

  await chunkAll({ inputDir: specsDir, outDir: chunksDir });
  const committedChunks = await fs.readFile(path.join(chunksDir, "index.json"));
  const cancellation = new AbortController();
  cancellation.abort("SIGINT");
  await assert.rejects(
    chunkAll({ inputDir: specsDir, outDir: chunksDir, signal: cancellation.signal }),
    (error) => error.code === "CANCELLED" && error.exitCode === 130,
  );
  assert.deepEqual(await fs.readFile(path.join(chunksDir, "index.json")), committedChunks);
});

test("rejects a snapshot index that rebinds content to another source", async (t) => {
  const root = await makeTempDir(t, "episteme-snapshot-rebinding-");
  const firstPath = path.join(root, "first.txt");
  const secondPath = path.join(root, "second.txt");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const firstUrl = "https://example.test/first";
  const secondUrl = "https://example.test/second";
  await fs.writeFile(firstPath, "First source evidence.", "utf8");
  await fs.writeFile(secondPath, "Second source evidence.", "utf8");
  await fs.writeFile(mapPath, JSON.stringify([
    { sourceUrl: firstUrl, localPath: firstPath, contentType: "text/plain; charset=utf-8" },
    { sourceUrl: secondUrl, localPath: secondPath, contentType: "text/plain; charset=utf-8" },
  ]));
  await manualIngest({ mapPath, snapshotsDir });
  const indexPath = path.join(snapshotsDir, "index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  index.entries[firstUrl].latest = index.entries[secondUrl].latest;
  index.entries[firstUrl].history.push(index.entries[secondUrl].latest);
  await writeJson(indexPath, withFingerprint(index));

  await assert.rejects(
    snapshotAll({ manifest: [{ url: firstUrl }], outDir: snapshotsDir }),
    (error) => error.code === "INVALID_INPUT" && /source mismatch/u.test(error.message),
  );

  const plugins = await loadFamilyPlugins();
  await assert.rejects(
    extractAll({
      manifest: [{ url: firstUrl, family: "generic", authority: null, extractor: "text" }],
      snapshotsDir,
      outDir: specsDir,
      resolvePlugin: pluginResolver(plugins),
    }),
    (error) => error.code === "INVALID_INPUT" && /source mismatch/u.test(error.message),
  );
});

test("runs a byte-reproducible extraction and bounded ranked query pipeline", async (t) => {
  const root = await makeTempDir(t, "episteme-pipeline-");
  const sourcePath = path.join(root, "source.html");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/spec";
  await fs.writeFile(
    sourcePath,
    "<!doctype html><title>Fixture</title><main><h1 id=entry>Entry</h1><p>Searchable deterministic evidence with a precise citation.</p><h2 id=details>Details</h2><p>Additional deterministic evidence for the second citation.</p></main>",
    "utf8",
  );
  await fs.writeFile(
    mapPath,
    JSON.stringify([{ sourceUrl, localPath: sourcePath, contentType: "text/html; charset=utf-8" }]),
    "utf8",
  );
  await manualIngest({ mapPath, snapshotsDir });
  const plugins = await loadFamilyPlugins();
  const manifest = [{ url: sourceUrl, family: "generic", authority: null, extractor: null }];
  const extraction = await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: pluginResolver(plugins),
  });
  const documentPath = extraction.documents[0].outputPath;
  const firstBytes = await fs.readFile(documentPath);
  const extracted = JSON.parse(firstBytes);
  await assertSchema(extracted, "offline-pipeline-document");
  assert.equal(extracted.sections[0].heading, "Entry");
  assert.equal(extracted.contentTrust, "untrusted-source");

  await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: pluginResolver(plugins),
  });
  assert.deepEqual(await fs.readFile(documentPath), firstBytes);

  const firstChunking = await chunkAll({ inputDir: specsDir, outDir: chunksDir, maxChars: 256, overlapChars: 32 });
  const firstChunkIndex = await fs.readFile(firstChunking.indexPath);
  await assertArtifact(JSON.parse(firstChunkIndex), "chunk index");
  const secondChunking = await chunkAll({ inputDir: specsDir, outDir: chunksDir, maxChars: 256, overlapChars: 32 });
  assert.equal(secondChunking.fingerprint, firstChunking.fingerprint);
  assert.deepEqual(await fs.readFile(secondChunking.indexPath), firstChunkIndex);

  const indexFile = path.join(chunksDir, "search-index.json");
  const built = await buildIndex({ chunksDir, outFile: indexFile });
  await assertArtifact(JSON.parse(await fs.readFile(indexFile, "utf8")), "search index");
  const rebuilt = await buildIndex({ chunksDir, outFile: indexFile });
  assert.equal(rebuilt.fingerprint, built.fingerprint);
  await chunkAll({ inputDir: specsDir, outDir: chunksDir, maxChars: 256, overlapChars: 32 });
  await fs.readFile(indexFile);
  const restored = await buildIndex({ chunksDir, outFile: indexFile });
  assert.equal(restored.fingerprint, built.fingerprint);
  const page = await queryIndex({ indexFile, term: "deterministic evidence", family: "generic", limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.nextOffset, 1);
  assert.equal(page.results[0].contentTrust, "untrusted-source");
  assert.equal(page.results[0].citation.url, sourceUrl);
  const secondPage = await queryIndex({
    indexFile,
    term: "deterministic evidence",
    family: "generic",
    limit: 1,
    offset: page.nextOffset,
  });
  assert.equal(secondPage.total, 2);
  assert.equal(secondPage.nextOffset, null);
  assert.notEqual(secondPage.results[0].chunkId, page.results[0].chunkId);
  assert.deepEqual(
    [page.results[0].heading, secondPage.results[0].heading].sort(),
    ["Details", "Entry"],
  );
  assert.deepEqual(
    await queryIndex({ indexFile, term: "deterministic", family: "w3c" }),
    {
      query: "deterministic",
      filters: { family: "w3c" },
      total: 0,
      offset: 0,
      limit: 10,
      nextOffset: null,
      results: [],
    },
  );

  const inMemory = await buildIndex({ chunksDir, outFile: null, includeArtifact: true });
  assert.equal(inMemory.indexFile, null);
  await assertArtifact(inMemory.artifact, "in-memory search index");
  assert.equal(
    (await queryIndex({
      indexFile: "-",
      inputStream: Readable.from([JSON.stringify(inMemory.artifact)]),
      term: "deterministic",
    })).total,
    2,
  );

  await fs.writeFile(sourcePath, "Changed evidence invalidates the old search index.", "utf8");
  await manualIngest({ mapPath, snapshotsDir });
  await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: pluginResolver(plugins),
  });
  await chunkAll({ inputDir: specsDir, outDir: chunksDir, maxChars: 256, overlapChars: 32 });
  await assert.rejects(
    queryIndex({ indexFile, term: "deterministic" }),
    (error) => error.code === "INVALID_INPUT" && /stale/u.test(error.message),
  );
});

test("preserves PDF provenance and limits through chunking", async (t) => {
  const root = await makeTempDir(t, "episteme-pdf-pipeline-");
  const mapPath = path.join(root, "map.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/minimal.pdf";
  const localPath = fileURLToPath(new URL("./fixtures/minimal.pdf", import.meta.url));
  await fs.writeFile(mapPath, JSON.stringify([{ sourceUrl, localPath, contentType: "application/pdf" }]));
  await manualIngest({ mapPath, snapshotsDir });
  const plugins = await loadFamilyPlugins();
  const extraction = await extractAll({
    manifest: [{ url: sourceUrl, family: "generic", extractor: "pdf", authority: null }],
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: pluginResolver(plugins),
  });
  const extracted = JSON.parse(await fs.readFile(extraction.documents[0].outputPath, "utf8"));
  await assertSchema(extracted, "offline-pdf-document");
  assert.equal(extracted.provenance.sourceSha256, extracted.source.sha256);

  await chunkAll({ inputDir: specsDir, outDir: chunksDir });
  const chunkIndex = JSON.parse(await fs.readFile(path.join(chunksDir, "index.json"), "utf8"));
  const chunk = JSON.parse(await fs.readFile(path.join(chunksDir, chunkIndex.chunks[0].path), "utf8"));
  assert.deepEqual(chunk.source.pageNumbers, [1]);
  assert.deepEqual(chunk.knownLimits, extracted.pdf.knownLimits);
  assert.deepEqual(chunk.diagnostics, extracted.diagnostics);
});

test("diffs added, removed, and changed documents and sections", async (t) => {
  const root = await makeTempDir(t, "episteme-diff-");
  const fromDir = path.join(root, "from");
  const toDir = path.join(root, "to");
  const outDir = path.join(root, "diff");
  const paragraph = (id, text) => ({
    id,
    heading: id,
    level: 1,
    blocks: [{ type: "paragraph", text }],
  });
  await writeDocumentCorpus(fromDir, [
    documentFixture({
      url: "https://example.test/shared",
      content: "old",
      sections: [paragraph("changed", "old"), paragraph("removed", "gone")],
    }),
    documentFixture({
      url: "https://example.test/removed",
      content: "removed",
      sections: [paragraph("only", "gone")],
    }),
  ]);
  await writeDocumentCorpus(toDir, [
    documentFixture({
      url: "https://example.test/shared",
      content: "new",
      sections: [paragraph("changed", "new"), paragraph("added", "here")],
    }),
    documentFixture({
      url: "https://example.test/added",
      content: "added",
      sections: [paragraph("only", "here")],
    }),
  ]);

  const result = await diffDirectories({ fromDir, toDir, outDir });
  const diff = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
  await assertArtifact(diff, "corpus diff");
  assert.deepEqual(diff.summary, {
    documents: { added: 1, changed: 1, removed: 1 },
    sections: { added: 2, changed: 1, removed: 2 },
  });
  assert.deepEqual(diff.documents.map((document) => document.status).sort(), ["added", "changed", "removed"]);

  const inMemory = await diffDirectories({ fromDir, toDir, outDir: null, includeArtifact: true });
  assert.equal(inMemory.outputPath, null);
  assert.equal(inMemory.fingerprint, result.fingerprint);
  await assertArtifact(inMemory.artifact, "in-memory corpus diff");
});

test("section diff identity does not depend on array position", async (t) => {
  const root = await makeTempDir(t, "episteme-diff-position-");
  const fromDir = path.join(root, "from");
  const toDir = path.join(root, "to");
  const outDir = path.join(root, "diff");
  const section = (id, text) => ({
    id,
    heading: id,
    level: 1,
    blocks: [{ type: "paragraph", text }],
  });
  const url = "https://example.test/stable-sections";
  const previous = documentFixture({
    url,
    content: "before",
    sections: [section("alpha", "same alpha"), section("omega", "same omega")],
  });
  const current = documentFixture({
    url,
    content: "after",
    sections: [
      section("new", "inserted"),
      section("alpha", "same alpha"),
      section("omega", "same omega"),
    ],
  });
  current.source = documentFixture({ url, content: "before", sections: [] }).source;
  current.provenance = documentFixture({ url, content: "before", sections: [] }).provenance;
  current.snapshotId = current.source.snapshotId;
  await writeDocumentCorpus(fromDir, [previous]);
  await writeDocumentCorpus(toDir, [current]);

  const result = await diffDirectories({ fromDir, toDir, outDir });
  const diff = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
  assert.deepEqual(diff.documents[0].sections, {
    added: ["id:new"],
    changed: [],
    removed: [],
  });
});

test("rejects duplicate identities in committed document indexes", async (t) => {
  const root = await makeTempDir(t, "episteme-duplicate-documents-");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const diffDir = path.join(root, "diff");
  const document = documentFixture({
    url: "https://example.test/duplicate",
    content: "duplicate",
    sections: [{
      id: "duplicate",
      heading: "Duplicate",
      level: 1,
      blocks: [{ type: "paragraph", text: "Duplicate evidence." }],
    }],
  });
  const index = await writeDocumentCorpus(specsDir, [document]);
  await writeJson(path.join(specsDir, "index.json"), withFingerprint({
    ...index,
    documents: [...index.documents, index.documents[0]],
    fingerprint: undefined,
  }));

  await assert.rejects(
    chunkAll({ inputDir: specsDir, outDir: chunksDir }),
    (error) => error.code === "INVALID_INPUT" && /duplicate identity/u.test(error.message),
  );
  await assert.rejects(
    diffDirectories({ fromDir: specsDir, toDir: specsDir, outDir: diffDir }),
    (error) => error.code === "INVALID_INPUT" && /duplicate identity/u.test(error.message),
  );
});
