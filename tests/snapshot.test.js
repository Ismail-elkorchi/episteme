import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSnapshotContent, snapshotUrl } from "../src/pipeline/snapshot.js";

test("snapshots redirects and records response metadata", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-snapshot-"));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));

  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/document" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("snapshot body");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/redirect`;
  const meta = await snapshotUrl(sourceUrl, outDir, 2_000);
  assert.equal(meta.sourceUrl, sourceUrl);
  assert.equal(meta.finalUrl.endsWith("/document"), true);
  assert.equal(meta.contentType, "text/plain; charset=utf-8");
  assert.equal(meta.charset, "utf8");
  assert.equal(meta.fileName, "content.txt");

  const snapshot = await loadSnapshotContent(outDir, meta.snapshotId);
  assert.equal(snapshot.buffer.toString("utf8"), "snapshot body");
});

test("rejects unsuccessful snapshot responses", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-snapshot-error-"));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));

  const server = http.createServer((_request, response) => {
    response.writeHead(503);
    response.end("unavailable");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  await assert.rejects(
    snapshotUrl(`http://127.0.0.1:${address.port}/failure`, outDir, 2_000),
    /Snapshot failed 503/,
  );
});
