#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { loadManifest } from "./manifest.js";
import { loadFamilyPlugins, resolveFamily } from "./registry.js";
import { snapshotAll } from "./pipeline/snapshot.js";
import { extractAll } from "./pipeline/extract.js";
import { chunkAll } from "./pipeline/chunk.js";
import { buildIndex, queryIndex } from "./pipeline/index.js";
import { diffDirectories } from "./pipeline/diff.js";
import { manualIngest } from "./pipeline/manual-ingest.js";

const DEFAULT_MANIFEST = "manifest.json";
const DEFAULT_SNAPSHOTS = "snapshots";
const DEFAULT_SPECS = "specs";
const DEFAULT_CHUNKS = "chunks";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  switch (command) {
    case "snapshot":
      await runSnapshot(options);
      break;
    case "extract":
      await runExtract(options);
      break;
    case "chunk":
      await runChunk(options);
      break;
    case "index":
      await runIndex(options);
      break;
    case "diff":
      await runDiff(options);
      break;
    case "query":
      await runQuery(options);
      break;
    case "manual-ingest":
      await runManualIngest(options);
      break;
    case "pipeline":
      await runPipeline(options);
      break;
    default:
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
    options[key] = value;
  }
  return options;
}

async function runSnapshot(options) {
  const manifestPath = path.resolve(process.cwd(), options.manifest || DEFAULT_MANIFEST);
  const outDir = path.resolve(process.cwd(), options.out || DEFAULT_SNAPSHOTS);
  const manifest = await loadManifest(manifestPath);
  await snapshotAll({
    manifest,
    outDir,
    reuseExisting: Boolean(options.reuse),
    timeoutMs: Number(options.timeout) || 60000,
  });
}

async function runExtract(options) {
  const manifestPath = path.resolve(process.cwd(), options.manifest || DEFAULT_MANIFEST);
  const snapshotsDir = path.resolve(process.cwd(), options.snapshots || DEFAULT_SNAPSHOTS);
  const outDir = path.resolve(process.cwd(), options.out || DEFAULT_SPECS);
  const format = options.format || "json";
  const manifest = await loadManifest(manifestPath);
  const plugins = await loadFamilyPlugins();
  await extractAll({
    manifest,
    snapshotsDir,
    outDir,
    format,
    plugins: {
      list: plugins,
      resolve: (url, explicit) => resolveFamily(plugins, url, explicit),
    },
  });
}

async function runChunk(options) {
  const inputDir = path.resolve(process.cwd(), options.input || DEFAULT_SPECS);
  const outDir = path.resolve(process.cwd(), options.out || DEFAULT_CHUNKS);
  await fs.mkdir(outDir, { recursive: true });
  await chunkAll({ inputDir, outDir });
}

async function runIndex(options) {
  const chunksDir = path.resolve(process.cwd(), options.chunks || DEFAULT_CHUNKS);
  const outFile = options.out ? path.resolve(process.cwd(), options.out) : null;
  await buildIndex({ chunksDir, outFile });
}

async function runDiff(options) {
  if (!options.from || !options.to) {
    throw new Error("diff requires --from and --to");
  }
  const fromDir = path.resolve(process.cwd(), options.from);
  const toDir = path.resolve(process.cwd(), options.to);
  const outDir = path.resolve(process.cwd(), options.out || "diffs");
  await fs.mkdir(outDir, { recursive: true });
  await diffDirectories({ fromDir, toDir, outDir });
}

async function runQuery(options) {
  if (!options.term) {
    throw new Error("query requires --term");
  }
  const indexFile = path.resolve(process.cwd(), options.index || path.join(DEFAULT_CHUNKS, "search-index.json"));
  const results = await queryIndex({
    indexFile,
    term: options.term,
    family: options.family || null,
  });
  console.log(JSON.stringify(results, null, 2));
}

async function runManualIngest(options) {
  if (!options.map) {
    throw new Error("manual-ingest requires --map");
  }
  const mapPath = path.resolve(process.cwd(), options.map);
  const snapshotsDir = path.resolve(process.cwd(), options.snapshots || DEFAULT_SNAPSHOTS);
  await manualIngest({
    mapPath,
    snapshotsDir,
    reuseExisting: Boolean(options.reuse),
    refresh: Boolean(options.refresh),
  });
}

async function runPipeline(options) {
  const manifestPath = path.resolve(process.cwd(), options.manifest || DEFAULT_MANIFEST);
  const snapshotsDir = path.resolve(process.cwd(), options.snapshots || DEFAULT_SNAPSHOTS);
  const specsDir = path.resolve(process.cwd(), options.specs || DEFAULT_SPECS);
  const chunksDir = path.resolve(process.cwd(), options.chunks || DEFAULT_CHUNKS);

  const manifest = await loadManifest(manifestPath);
  await snapshotAll({
    manifest,
    outDir: snapshotsDir,
    reuseExisting: Boolean(options.reuse),
    timeoutMs: Number(options.timeout) || 60000,
  });

  const plugins = await loadFamilyPlugins();
  await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    format: options.format || "json",
    plugins: {
      list: plugins,
      resolve: (url, explicit) => resolveFamily(plugins, url, explicit),
    },
  });

  await chunkAll({ inputDir: specsDir, outDir: chunksDir });
  await buildIndex({ chunksDir, outFile: path.join(chunksDir, "search-index.json") });
}

function printHelp() {
  console.log(`episteme CLI

Commands:
  snapshot --manifest manifest.json --out snapshots
  extract  --manifest manifest.json --snapshots snapshots --out specs --format json
  chunk    --input specs --out chunks
  index    --chunks chunks --out chunks/search-index.json
  diff     --from specs-old --to specs-new --out diffs
  query    --index chunks/search-index.json --term "popover"
  manual-ingest --map manual-ingest.json --snapshots snapshots --refresh
  pipeline --manifest manifest.json --snapshots snapshots --specs specs --chunks chunks
`);
}

await main();
