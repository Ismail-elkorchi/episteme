import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const allowedPackPrefixes = [
  "package.json",
  "README.md",
  "schema/",
  "src/",
];

const requiredJsrExcludes = [
  "AGENTS.md",
  "DEVELOPMENT.md",
  "SPEC.md",
  "docs",
  "scripts",
  ".github",
  "examples",
  "tests",
  "node_modules",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkNpmPack() {
  const output = execSync("npm pack --json --dry-run", { encoding: "utf8" });
  const parsed = JSON.parse(output);
  const files = parsed[0]?.files?.map((file) => file.path) ?? [];
  const violations = files.filter((file) =>
    !allowedPackPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))
  );
  if (violations.length > 0) {
    fail(`npm package contains files outside public allowlist: ${violations.join(", ")}`);
  }
}

function checkJsrConfig() {
  const jsrPath = path.join(root, "jsr.json");
  if (!fs.existsSync(jsrPath)) {
    fail("jsr.json is missing");
  }
  const jsr = JSON.parse(fs.readFileSync(jsrPath, "utf8"));
  const exclude = new Set((jsr.exclude ?? []).map((entry) => entry.replace(/\/$/, "")));
  const missing = requiredJsrExcludes.filter((entry) => !exclude.has(entry.replace(/\/$/, "")));
  if (missing.length > 0) {
    fail(`jsr.json exclude missing required entries: ${missing.join(", ")}`);
  }
}

checkNpmPack();
checkJsrConfig();
console.log("package checks passed");
