import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedPackPrefixes = [
  "package.json",
  "README.md",
  "LICENSE",
  "schema/",
  "src/",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkNpmPack() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  if (packageJson.name !== "episteme") {
    fail(`unexpected npm package name: ${packageJson.name}`);
  }
  if (packageJson.bin?.episteme !== "src/cli.js") {
    fail("npm package must expose the episteme CLI");
  }

  const output = execSync("npm pack --json --dry-run", { encoding: "utf8" });
  const parsed = JSON.parse(output);
  const pack = parsed[0];
  if (pack?.name !== "episteme") {
    fail(`npm pack reported an unexpected package name: ${pack?.name}`);
  }

  const files = pack?.files?.map((file) => file.path) ?? [];
  const violations = files.filter((file) =>
    !allowedPackPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)),
  );
  if (violations.length > 0) {
    fail(`npm package contains files outside public allowlist: ${violations.join(", ")}`);
  }

  for (const requiredFile of ["README.md", "LICENSE", "schema/document.schema.json", "src/cli.js"]) {
    if (!files.includes(requiredFile)) {
      fail(`npm package is missing required file: ${requiredFile}`);
    }
  }
}

checkNpmPack();
console.log("package checks passed");
