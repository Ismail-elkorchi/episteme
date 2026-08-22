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

  let conditionalRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/document" });
      response.end();
      return;
    }
    if (request.headers["if-none-match"] === '"fixture-v1"') {
      conditionalRequests += 1;
      response.writeHead(304, { etag: '"fixture-v1"' });
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      etag: '"fixture-v1"',
    });
    response.end("snapshot body");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/redirect`;
  const first = await snapshotUrl(sourceUrl, outDir, { timeoutMs: 2_000, retries: 0 });
  const meta = first.meta;
  assert.equal(first.status, "captured");
  assert.equal(meta.sourceUrl, sourceUrl);
  assert.equal(meta.finalUrl.endsWith("/document"), true);
  assert.equal(meta.contentType, "text/plain; charset=utf-8");
  assert.equal(meta.charset, "utf8");
  assert.equal(meta.fileName, "content.txt");

  const snapshot = await loadSnapshotContent(outDir, meta.snapshotId);
  assert.equal(snapshot.buffer.toString("utf8"), "snapshot body");

  const second = await snapshotUrl(sourceUrl, outDir, {
    timeoutMs: 2_000,
    retries: 0,
    previous: meta,
  });
  assert.equal(second.status, "unchanged");
  assert.equal(second.meta.snapshotId, meta.snapshotId);
  assert.equal(conditionalRequests, 1);
});

test("retries bounded transient failures", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-snapshot-retry-"));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    if (requests === 1) {
      response.writeHead(503, { "retry-after": "0" });
      response.end("retry");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("available");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const captured = await snapshotUrl(`http://127.0.0.1:${address.port}/eventual`, outDir, {
    timeoutMs: 2_000,
    retries: 1,
  });
  assert.equal(captured.status, "captured");
  assert.equal(requests, 2);
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
    snapshotUrl(`http://127.0.0.1:${address.port}/failure`, outDir, {
      timeoutMs: 2_000,
      retries: 0,
    }),
    /Snapshot failed with HTTP 503/u,
  );
});

test("enforces the response byte limit while streaming", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-snapshot-limit-"));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("0123456789");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  await assert.rejects(
    snapshotUrl(`http://127.0.0.1:${address.port}/large`, outDir, {
      timeoutMs: 2_000,
      retries: 0,
      maxBytes: 5,
    }),
    (error) => error.code === "LIMIT_EXCEEDED",
  );
});

test("applies the request timeout while streaming the body", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-snapshot-timeout-"));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("partial");
    const timer = setTimeout(() => response.end(" late"), 200);
    response.on("close", () => clearTimeout(timer));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  await assert.rejects(
    snapshotUrl(`http://127.0.0.1:${address.port}/slow`, outDir, {
      timeoutMs: 25,
      retries: 0,
    }),
    (error) => error.code === "SOURCE_UNAVAILABLE" && error.retryable === true,
  );
});
