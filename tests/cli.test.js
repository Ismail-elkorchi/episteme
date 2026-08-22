import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const isNode = typeof globalThis.Deno === "undefined" && typeof globalThis.Bun === "undefined";
const repositoryRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = path.join(repositoryRoot, "src", "cli.js");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("prints help successfully with no command", { skip: !isNode }, () => {
  const result = runCli([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /episteme CLI/);
  assert.match(result.stdout, /pipeline --manifest/);
});

test("rejects unknown commands", { skip: !isNode }, () => {
  const result = runCli(["unknown"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /episteme CLI/);
});

test("reports missing required command options", { skip: !isNode }, () => {
  const result = runCli(["diff"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /diff requires --from and --to/);
});
