import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertArtifact, assertCliEnvelope } from "./helpers/schema-validator.js";

const isNode = typeof globalThis.Deno === "undefined" && typeof globalThis.Bun === "undefined";
const repositoryRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function parseOnlyLine(output) {
  const lines = output.trim().split("\n");
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

test("shows conventional human-readable help by default", { skip: !isNode }, () => {
  const result = runCli([]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Usage:\n  episteme <command>/u);
  assert.match(result.stdout, /Commands:/u);
  assert.match(result.stdout, /query\s+Return bounded, ranked evidence/u);
  assert.doesNotMatch(result.stdout, /^\{/u);
});

test("supports top-level and command help, including help with --json", { skip: !isNode }, () => {
  for (const args of [["--help"], ["help"], ["unknown", "--help"], ["--help", "--json"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0, args.join(" "));
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage:/u);
  }

  for (const args of [["query", "--help"], ["help", "query"], ["query", "--help", "--json"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0, args.join(" "));
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /episteme query --term <query>/u);
    assert.match(result.stdout, /--limit/u);
  }
});

test("removes describe without a compatibility command", { skip: !isNode }, () => {
  const result = runCli(["describe"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^error: Unknown command: describe/u);
  assert.doesNotMatch(result.stderr, /^\{/u);
});

test("uses human output by default and JSON only under --json", { skip: !isNode }, async () => {
  const human = runCli(["--version"]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /^episteme \d/u);
  assert.equal(human.stderr, "");

  const machine = runCli(["--version", "--json"]);
  assert.equal(machine.status, 0);
  assert.equal(machine.stderr, "");
  const envelope = parseOnlyLine(machine.stdout);
  await assertCliEnvelope(envelope);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, "version");
  assert.equal(envelope.data.name, "episteme");
});

test("reports human errors by default and schema-valid errors under --json", { skip: !isNode }, async () => {
  const human = runCli(["unknown"]);
  assert.equal(human.status, 2);
  assert.equal(human.stdout, "");
  assert.match(human.stderr, /^error: Unknown command: unknown/u);
  assert.match(human.stderr, /hint:/u);
  assert.doesNotMatch(human.stderr, /at main/u);

  const machine = runCli(["unknown", "--json"]);
  assert.equal(machine.status, 2);
  assert.equal(machine.stdout, "");
  const envelope = parseOnlyLine(machine.stderr);
  await assertCliEnvelope(envelope);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "INVALID_USAGE");
  assert.equal(envelope.error.retryable, false);

  const debug = runCli(["unknown", "--json", "--debug"]);
  const debugEnvelope = parseOnlyLine(debug.stderr);
  await assertCliEnvelope(debugEnvelope);
  assert.ok(debugEnvelope.error.debug.causes.length >= 1);
});

test("validates typed options, stdout artifacts, and progress mode before work", { skip: !isNode }, () => {
  const missing = runCli(["diff"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires --from/u);

  const invalidLimit = runCli(["query", "--term", "evidence", "--limit", "0"]);
  assert.equal(invalidLimit.status, 2);
  assert.match(invalidLimit.stderr, /must be an integer/u);

  const stdoutArtifact = runCli(["index", "--out", "-"]);
  assert.equal(stdoutArtifact.status, 2);
  assert.match(stdoutArtifact.stderr, /requires --json/u);

  const invalidProgress = runCli(["--progress=occasionally", "query", "--term", "evidence"]);
  assert.equal(invalidProgress.status, 2);
  assert.match(invalidProgress.stderr, /auto, always, never/u);
});

test("runs the successful agent workflow through the executable", { skip: !isNode }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-cli-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.txt");
  const mapPath = path.join(root, "manual-ingest.json");
  const manifestPath = path.join(root, "manifest.json");
  const snapshotsDir = path.join(root, "snapshots");
  const specsDir = path.join(root, "specs");
  const chunksDir = path.join(root, "chunks");
  const sourceUrl = "https://example.test/agent-evidence";
  await fs.writeFile(sourcePath, "Deterministic agent evidence with an attributable citation.", "utf8");
  await fs.writeFile(mapPath, JSON.stringify([{
    sourceUrl,
    localPath: sourcePath,
    contentType: "text/plain; charset=utf-8",
  }]));
  await fs.writeFile(manifestPath, JSON.stringify([{
    url: sourceUrl,
    family: "generic",
    extractor: "text",
  }]));

  const ingest = runCli([
    "manual-ingest", "--map", mapPath, "--snapshots", snapshotsDir, "--progress", "never",
  ]);
  assert.equal(ingest.status, 0, ingest.stderr);
  assert.match(ingest.stdout, /^Ingested 1 source\(s\): 1 new/u);
  assert.equal(ingest.stderr, "");

  const pipeline = runCli([
    "pipeline", "--manifest", manifestPath, "--snapshots", snapshotsDir,
    "--specs", specsDir, "--chunks", chunksDir, "--reuse", "--json", "--progress", "never",
  ]);
  assert.equal(pipeline.status, 0, pipeline.stderr);
  assert.equal(pipeline.stderr, "");
  const pipelineEnvelope = parseOnlyLine(pipeline.stdout);
  await assertCliEnvelope(pipelineEnvelope, "pipeline CLI envelope");
  assert.equal(pipelineEnvelope.ok, true);
  assert.equal(pipelineEnvelope.command, "pipeline");
  assert.equal(pipelineEnvelope.data.chunk.counts.chunks, 1);

  const query = runCli([
    "query", "--index", path.join(chunksDir, "search-index.json"),
    "--term", "agent evidence", "--json", "--progress", "never",
  ]);
  assert.equal(query.status, 0, query.stderr);
  const queryEnvelope = parseOnlyLine(query.stdout);
  await assertCliEnvelope(queryEnvelope, "query CLI envelope");
  assert.equal(queryEnvelope.data.total, 1);
  assert.equal(queryEnvelope.data.results[0].citation.url, sourceUrl);

  const streamedIndex = runCli([
    "index", "--chunks", chunksDir, "--out", "-", "--json", "--progress", "never",
  ]);
  assert.equal(streamedIndex.status, 0, streamedIndex.stderr);
  const indexEnvelope = parseOnlyLine(streamedIndex.stdout);
  await assertCliEnvelope(indexEnvelope, "streamed index CLI envelope");
  await assertArtifact(indexEnvelope.data.artifact, "streamed search index");
});
