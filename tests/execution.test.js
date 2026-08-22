import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProgressReporter, readJsonInput, withOutputLocks, writeFileAtomic } from "../src/execution.js";

async function makeTempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-execution-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("atomic writes replace complete files without leaving temporary files", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "nested", "artifact.json");
  await writeFileAtomic(target, "first", "utf8");
  await writeFileAtomic(target, "second", "utf8");
  assert.equal(await fs.readFile(target, "utf8"), "second");
  assert.deepEqual(await fs.readdir(path.dirname(target)), ["artifact.json"]);
});

test("output locks reject live contenders and recover stale locks when liveness is available", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "corpus");
  await withOutputLocks([target], async () => {
    await assert.rejects(
      withOutputLocks([target], async () => {}),
      (error) => error.code === "RESOURCE_BUSY" && error.retryable === true,
    );
  });

  // Deno intentionally has no --allow-sys here. Without a process-liveness probe,
  // lock recovery stays conservative instead of risking removal of a live lock.
  if (typeof globalThis.Deno !== "undefined") return;

  const lockPath = path.join(root, ".corpus.episteme.lock");
  await fs.mkdir(lockPath);
  await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
    token: "stale",
    pid: 2_147_483_647,
    hostname: safeHostname(),
    command: "chunk",
  }));
  let ran = false;
  await withOutputLocks([target], async () => { ran = true; });
  assert.equal(ran, true);
  await assert.rejects(fs.access(lockPath));
});

function safeHostname() {
  if (process.env.HOSTNAME) return process.env.HOSTNAME;
  try {
    return os.hostname();
  } catch {
    return null;
  }
}

test("progress is human-readable normally and JSONL with --json", () => {
  const humanLines = [];
  const human = createProgressReporter({
    command: "chunk",
    mode: "always",
    stream: { isTTY: false, write: (value) => humanLines.push(value) },
  });
  human({ stage: "chunk", message: "Chunking \u001bsource", current: 1, total: 2, status: "started" });
  assert.equal(humanLines[0], "chunk: Chunking source (1/2)\n");

  const jsonLines = [];
  const machine = createProgressReporter({
    command: "chunk",
    mode: "always",
    json: true,
    stream: { isTTY: false, write: (value) => jsonLines.push(value) },
  });
  machine({ stage: "chunk", message: "Done", status: "completed" });
  assert.deepEqual(JSON.parse(jsonLines[0]), {
    type: "progress",
    command: "chunk",
    stage: "chunk",
    message: "Done",
    status: "completed",
  });
});

test("bounded stdin reads respond to cancellation while awaiting input", async () => {
  const controller = new AbortController();
  let returned = false;
  const input = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: async () => {
          returned = true;
          return { done: true };
        },
      };
    },
  };
  const reading = readJsonInput("-", {
    stdin: input,
    maxBytes: 1_024,
    signal: controller.signal,
  });
  controller.abort("SIGINT");
  await assert.rejects(reading, (error) => error.code === "CANCELLED");
  assert.equal(returned, true);
});
