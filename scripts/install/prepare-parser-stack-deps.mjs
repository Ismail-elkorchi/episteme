import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES = [
  { name: "html-parser", skipPlaywrightDownload: false },
  { name: "css-parser", skipPlaywrightDownload: true },
  { name: "xml-parser", skipPlaywrightDownload: false },
];

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
}

function packageDir(name) {
  return resolve("node_modules", name);
}

function distEntry(name) {
  return resolve(packageDir(name), "dist", "mod.js");
}

function ensureBuilt({ name, skipPlaywrightDownload }) {
  const distPath = distEntry(name);
  if (existsSync(distPath)) {
    console.log(`prepare:parser-stack ${name} dist already present`);
    return;
  }

  const dir = packageDir(name);
  if (!existsSync(dir)) {
    throw new Error(`prepare:parser-stack missing dependency directory: ${dir}`);
  }

  const env = {
    ...process.env,
    ...(skipPlaywrightDownload ? { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } : {}),
  };

  console.log(`prepare:parser-stack installing dev dependencies for ${name}`);
  run("npm", ["--prefix", dir, "ci", "--include=dev", "--ignore-scripts"], env);

  console.log(`prepare:parser-stack building ${name}`);
  run("npm", ["--prefix", dir, "run", "build"], env);

  if (!existsSync(distPath)) {
    throw new Error(`prepare:parser-stack build completed but dist missing for ${name}: ${distPath}`);
  }
}

for (const pkg of PACKAGES) {
  ensureBuilt(pkg);
}

console.log("prepare:parser-stack complete");
