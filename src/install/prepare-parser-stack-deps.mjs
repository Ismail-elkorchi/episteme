import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const deps = ["html-parser", "css-parser"];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${String(result.status)}`);
  }
}

function prepareDependency(rootDir, depName) {
  const depRoot = path.join(rootDir, "node_modules", depName);
  if (!fs.existsSync(depRoot)) {
    return;
  }

  const distEntry = path.join(depRoot, "dist", "mod.js");
  if (fs.existsSync(distEntry)) {
    return;
  }

  run("npm", ["--prefix", depRoot, "install", "--include=dev", "--no-audit", "--no-fund"]);
  run("npm", ["--prefix", depRoot, "run", "build"]);
}

function main() {
  if (process.env.EPISTEME_SKIP_PARSER_STACK_PREP === "1") {
    return;
  }

  const rootDir = process.cwd();
  for (const depName of deps) {
    prepareDependency(rootDir, depName);
  }
}

try {
  main();
} catch (error) {
  console.error("Failed to prepare parser-stack dependencies", error);
  process.exit(1);
}

