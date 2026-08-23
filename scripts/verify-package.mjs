import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { EPISTEME_VERSION } from "../src/constants.js";

const EXPECTED_NPM_NAME = "episteme";
const EXPECTED_JSR_NAME = "@ismail-elkorchi/episteme";
const allowedPackPrefixes = [
  "package.json",
  "README.md",
  "LICENSE",
  "schema/",
  "src/",
];
const expectedJsrIncludes = [
  "LICENSE",
  "README.md",
  "package.json",
  "schema/**/*.json",
  "src/**/*.d.ts",
  "src/**/*.js",
];
const expectedJsrImports = {
  "@ismail-elkorchi/http-client": "jsr:@ismail-elkorchi/http-client@0.1.1",
  "clivoke": "jsr:@ismail-elkorchi/clivoke@0.2.0",
};
const expectedMinimumDependencyAge = {
  age: "P1D",
  exclude: [
    "jsr:@ismail-elkorchi/http-client",
    "jsr:@ismail-elkorchi/clivoke",
    "jsr:@ismail-elkorchi/cli-core",
  ],
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkNpmPack() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  if (packageJson.name !== EXPECTED_NPM_NAME) {
    fail(`unexpected npm package name: ${packageJson.name}`);
  }
  if (packageJson.version !== EPISTEME_VERSION) {
    fail(`package version and runtime version disagree: ${packageJson.version} != ${EPISTEME_VERSION}`);
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

  for (const requiredFile of [
    "README.md",
    "LICENSE",
    "schema/artifact.schema.json",
    "schema/cli-envelope.schema.json",
    "schema/document.schema.json",
    "src/cli.d.ts",
    "src/cli.js",
  ]) {
    if (!files.includes(requiredFile)) {
      fail(`npm package is missing required file: ${requiredFile}`);
    }
  }
}

function checkJsrPackage() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const jsr = JSON.parse(readFileSync("jsr.json", "utf8"));
  if (jsr.name !== EXPECTED_JSR_NAME) {
    fail(`unexpected JSR package name: ${jsr.name}`);
  }
  if (jsr.version !== packageJson.version || jsr.version !== EPISTEME_VERSION) {
    fail(
      `JSR, npm, and runtime versions disagree: ${jsr.version} != ${packageJson.version} != ${EPISTEME_VERSION}`,
    );
  }
  if (Object.keys(jsr.exports || {}).length !== 1 || jsr.exports?.["./cli"] !== "./src/cli.js") {
    fail("JSR package must expose only the explicit ./cli entrypoint");
  }
  if (JSON.stringify(jsr.imports) !== JSON.stringify(expectedJsrImports)) {
    fail(`unexpected JSR imports: ${JSON.stringify(jsr.imports)}`);
  }
  if (
    JSON.stringify(jsr.minimumDependencyAge) !==
      JSON.stringify(expectedMinimumDependencyAge)
  ) {
    fail(
      `unexpected JSR minimum dependency age: ${JSON.stringify(jsr.minimumDependencyAge)}`,
    );
  }
  const includes = jsr.publish?.include;
  if (!Array.isArray(includes) || !sameStringSet(includes, expectedJsrIncludes)) {
    fail(`unexpected JSR publish allowlist: ${JSON.stringify(includes)}`);
  }
}

function sameStringSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}

checkNpmPack();
checkJsrPackage();
console.log("package checks passed");
