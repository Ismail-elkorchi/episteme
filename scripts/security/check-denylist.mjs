import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const BANNED_DEPENDENCIES = ["fast-xml-parser"];
const SCAN_TARGETS = [
  "package.json",
  "package-lock.json",
  "deno.lock",
  "README.md",
  "DEVELOPMENT.md",
  "src",
  "tests",
  "docs",
];

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".txt",
  ".yaml",
  ".yml",
]);

function isTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || path.basename(filePath) === "deno.lock";
}

async function collectFiles(rootPath) {
  const stats = await fs.stat(rootPath).catch(() => null);
  if (!stats) {
    return [];
  }
  if (stats.isFile()) {
    return [rootPath];
  }

  const files = [];
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function findMatches(content, term) {
  const matches = [];
  let start = 0;
  while (true) {
    const index = content.indexOf(term, start);
    if (index === -1) {
      break;
    }
    matches.push(index);
    start = index + term.length;
  }
  return matches;
}

function lineFromOffset(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

async function main() {
  const repositoryRoot = process.cwd();
  const findings = [];

  for (const relativeTarget of SCAN_TARGETS) {
    const targetPath = path.join(repositoryRoot, relativeTarget);
    const files = await collectFiles(targetPath);
    for (const filePath of files) {
      if (!isTextFile(filePath)) {
        continue;
      }
      const content = await fs.readFile(filePath, "utf8");
      for (const dependencyName of BANNED_DEPENDENCIES) {
        const hits = findMatches(content, dependencyName);
        for (const hit of hits) {
          findings.push({
            dependencyName,
            filePath: path.relative(repositoryRoot, filePath),
            line: lineFromOffset(content, hit),
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error("denylist check failed: banned dependency reference found");
    for (const finding of findings) {
      console.error(`- ${finding.dependencyName} at ${finding.filePath}:${finding.line}`);
    }
    process.exit(1);
  }

  console.log("denylist check passed");
}

await main();
