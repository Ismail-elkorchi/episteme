import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES = [
  {
    label: "html-parser",
    packageName: "@ismail-elkorchi/html-parser",
    installDir: resolve("node_modules", "@ismail-elkorchi", "html-parser"),
    skipPlaywrightDownload: false,
  },
  {
    label: "css-parser",
    packageName: "@ismail-elkorchi/css-parser",
    installDir: resolve("node_modules", "@ismail-elkorchi", "css-parser"),
    skipPlaywrightDownload: true,
  },
  {
    label: "xml-parser",
    packageName: "@ismail-elkorchi/xml-parser",
    installDir: resolve("node_modules", "@ismail-elkorchi", "xml-parser"),
    skipPlaywrightDownload: false,
  },
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

function distEntry(installDir) {
  return resolve(installDir, "dist", "mod.js");
}

function ensureBuilt({ label, packageName, installDir, skipPlaywrightDownload }) {
  const distPath = distEntry(installDir);
  if (existsSync(distPath)) {
    console.log(`prepare:parser-stack ${label} dist already present`);
    return;
  }

  if (!existsSync(installDir)) {
    throw new Error(`prepare:parser-stack missing dependency directory: ${installDir}`);
  }

  const env = {
    ...process.env,
    ...(skipPlaywrightDownload ? { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } : {}),
  };

  console.log(`prepare:parser-stack installing dev dependencies for ${packageName}`);
  run("npm", ["--prefix", installDir, "ci", "--include=dev", "--ignore-scripts"], env);

  console.log(`prepare:parser-stack building ${packageName}`);
  run("npm", ["--prefix", installDir, "run", "build"], env);

  if (!existsSync(distPath)) {
    throw new Error(`prepare:parser-stack build completed but dist missing for ${packageName}: ${distPath}`);
  }
}

for (const pkg of PACKAGES) {
  ensureBuilt(pkg);
}

console.log("prepare:parser-stack complete");
