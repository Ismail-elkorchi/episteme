#!/usr/bin/env node
/* @ts-self-types="./cli.d.ts" */
import path from "node:path";
import { parseInvocation, detectGlobalIntent, renderHelp } from "./cli-contract.js";
import { ARTIFACT_SCHEMA_VERSION, EPISTEME_VERSION } from "./constants.js";
import { cancelledError, normalizeError, throwIfAborted } from "./errors.js";
import { createProgressReporter, withOutputLocks } from "./execution.js";
import { loadManifest } from "./manifest.js";
import { loadFamilyPlugins, resolveFamily } from "./registry.js";
import { snapshotAll } from "./pipeline/snapshot.js";
import { extractAll } from "./pipeline/extract.js";
import { chunkAll } from "./pipeline/chunk.js";
import { buildIndex, queryIndex } from "./pipeline/index.js";
import { diffDirectories } from "./pipeline/diff.js";
import { manualIngest } from "./pipeline/manual-ingest.js";
import { canonicalJson } from "./utils.js";

const cancellation = installCancellationHandlers();
await main(process.argv.slice(2), cancellation.signal);
cancellation.dispose();

async function main(argv, signal) {
  const intent = detectGlobalIntent(argv);
  let invocation = null;
  let progress = () => {};
  try {
    invocation = parseInvocation(argv);
    if (invocation.action === "help") {
      process.stdout.write(`${renderHelp(invocation.command)}\n`);
      return;
    }
    if (invocation.action === "version") {
      if (invocation.global.json) writeSuccess("version", { name: "episteme", version: EPISTEME_VERSION }, []);
      else process.stdout.write(`episteme ${EPISTEME_VERSION}\n`);
      return;
    }

    progress = createProgressReporter({
      command: invocation.command,
      mode: invocation.global.progress,
      json: invocation.global.json,
    });
    const context = { signal, onProgress: progress, stdin: process.stdin };
    const targets = lockTargets(invocation);
    const { data, warnings = [] } = await withOutputLocks(
      targets,
      () => execute(invocation, context),
      { command: invocation.command },
    );
    throwIfAborted(signal);
    if (invocation.global.json) writeSuccess(invocation.command, data, warnings);
    else writeHumanSuccess(invocation.command, data, warnings);
  } catch (caught) {
    const interrupted = signal.aborted && caught?.code !== "CANCELLED"
      ? cancelledError(typeof signal.reason === "string" ? signal.reason : "SIGINT")
      : caught;
    const error = normalizeError(interrupted);
    progress({ stage: invocation?.command || "episteme", message: error.message, status: "failed" });
    const global = invocation?.global || intent;
    if (global.json) writeJsonError(invocation?.command || commandFromArgv(argv), error, global.debug);
    else writeHumanError(invocation?.command || commandFromArgv(argv), error, global.debug);
    process.exitCode = error.exitCode;
  }
}

async function execute({ command, options }, context) {
  switch (command) {
    case "snapshot":
      return runSnapshot(options, context);
    case "manual-ingest":
      return runManualIngest(options, context);
    case "extract":
      return runExtract(options, context);
    case "chunk":
      return runChunk(options, context);
    case "index":
      return runIndex(options, context);
    case "query":
      return runQuery(options, context);
    case "diff":
      return runDiff(options, context);
    case "pipeline":
      return runPipeline(options, context);
    default:
      throw new Error(`Unimplemented command: ${command}`);
  }
}

async function runSnapshot(options, context) {
  const manifest = await loadManifest(inputPath(options.manifest), {
    maxSources: options.maxSources,
    maxInputBytes: options.maxInputBytes,
    stdin: context.stdin,
    signal: context.signal,
  });
  const data = await snapshotAll({
    manifest,
    outDir: outputPath(options.out),
    reuseExisting: options.reuse,
    timeoutMs: options.timeout,
    maxBytes: options.maxBytes,
    retries: options.retries,
    ...context,
  });
  return { data };
}

async function runManualIngest(options, context) {
  const data = await manualIngest({
    mapPath: inputPath(options.map),
    snapshotsDir: outputPath(options.snapshots),
    maxBytes: options.maxBytes,
    maxSources: options.maxSources,
    maxInputBytes: options.maxInputBytes,
    ...context,
  });
  return { data };
}

async function runExtract(options, context) {
  const manifest = await loadManifest(inputPath(options.manifest), {
    maxSources: options.maxSources,
    maxInputBytes: options.maxInputBytes,
    stdin: context.stdin,
    signal: context.signal,
  });
  const plugins = await loadFamilyPlugins();
  const data = await extractAll({
    manifest,
    snapshotsDir: inputPath(options.snapshots),
    outDir: outputPath(options.out),
    resolvePlugin: (url, family) => resolveFamily(plugins, url, family),
    ...context,
  });
  return { data, warnings: [...extractionWarnings(data), ...maintenanceWarnings(data)] };
}

async function runChunk(options, context) {
  const data = await chunkAll({
    inputDir: inputPath(options.input),
    outDir: outputPath(options.out),
    maxChars: options.maxChars,
    overlapChars: options.overlapChars,
    ...context,
  });
  return { data, warnings: maintenanceWarnings(data) };
}

async function runIndex(options, context) {
  const data = await buildIndex({
    chunksDir: inputPath(options.chunks),
    outFile: options.out === "-" ? null : outputPath(options.out),
    includeArtifact: options.out === "-",
    ...context,
  });
  return { data };
}

async function runQuery(options, context) {
  const data = await queryIndex({
    indexFile: inputPath(options.index),
    inputStream: context.stdin,
    maxInputBytes: options.maxInputBytes,
    term: options.term,
    family: options.family,
    authority: options.authority,
    documentType: options.documentType,
    normativity: options.normativity,
    limit: options.limit,
    offset: options.offset,
    maxChars: options.maxChars,
    signal: context.signal,
  });
  return { data };
}

async function runDiff(options, context) {
  const data = await diffDirectories({
    fromDir: inputPath(options.from),
    toDir: inputPath(options.to),
    outDir: options.out === "-" ? null : outputPath(options.out),
    includeArtifact: options.out === "-",
    ...context,
  });
  return { data };
}

async function runPipeline(options, context) {
  const manifest = await loadManifest(inputPath(options.manifest), {
    maxSources: options.maxSources,
    maxInputBytes: options.maxInputBytes,
    stdin: context.stdin,
    signal: context.signal,
  });
  const snapshotsDir = outputPath(options.snapshots);
  const specsDir = outputPath(options.specs);
  const chunksDir = outputPath(options.chunks);
  context.onProgress({ stage: "pipeline", message: "Capturing sources", status: "started" });
  const snapshot = await snapshotAll({
    manifest,
    outDir: snapshotsDir,
    reuseExisting: options.reuse,
    timeoutMs: options.timeout,
    maxBytes: options.maxBytes,
    retries: options.retries,
    ...context,
  });
  context.onProgress({ stage: "pipeline", message: "Extracting documents", status: "started" });
  const plugins = await loadFamilyPlugins();
  const extract = await extractAll({
    manifest,
    snapshotsDir,
    outDir: specsDir,
    resolvePlugin: (url, family) => resolveFamily(plugins, url, family),
    ...context,
  });
  context.onProgress({ stage: "pipeline", message: "Creating evidence chunks", status: "started" });
  const chunk = await chunkAll({
    inputDir: specsDir,
    outDir: chunksDir,
    maxChars: options.maxChars,
    overlapChars: options.overlapChars,
    ...context,
  });
  context.onProgress({ stage: "pipeline", message: "Building search index", status: "started" });
  const index = await buildIndex({
    chunksDir,
    outFile: path.join(chunksDir, "search-index.json"),
    ...context,
  });
  return {
    data: { snapshot, extract, chunk, index },
    warnings: [
      ...extractionWarnings(extract),
      ...maintenanceWarnings(extract),
      ...maintenanceWarnings(chunk),
    ],
  };
}

function lockTargets({ command, options }) {
  const target = (value) => value && value !== "-" ? path.resolve(process.cwd(), value) : null;
  switch (command) {
    case "snapshot": return [target(options.out)];
    case "manual-ingest": return [target(options.snapshots)];
    case "extract": return [target(options.snapshots), target(options.out)];
    case "chunk": return [target(options.input), target(options.out)];
    case "index": return [target(options.chunks), target(options.out)];
    case "query": return [target(options.index)];
    case "diff": return [target(options.from), target(options.to), target(options.out)];
    case "pipeline": return [target(options.snapshots), target(options.specs), target(options.chunks)];
    default: return [];
  }
}

function extractionWarnings(result) {
  return result.documents.flatMap((document) => document.warnings.map((message) => ({
    code: "EXTRACTION_WARNING",
    message,
    url: document.url,
    snapshotId: document.snapshotId,
  })));
}

function maintenanceWarnings(result) {
  return (result.maintenanceWarnings || []).map((message) => ({
    code: "MAINTENANCE_WARNING",
    message,
  }));
}

function inputPath(value) {
  return value === "-" ? "-" : path.resolve(process.cwd(), value);
}

function outputPath(value) {
  return value === "-" ? "-" : path.resolve(process.cwd(), value);
}

function writeSuccess(command, data, warnings) {
  writeEnvelope(process.stdout, { ok: true, command, data, warnings, error: null });
}

function writeJsonError(command, error, debug) {
  writeEnvelope(process.stderr, {
    ok: false,
    command,
    data: null,
    warnings: [],
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
      ...(debug ? { debug: debugDetails(error) } : {}),
    },
  });
}

function writeEnvelope(stream, fields) {
  const envelope = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    ...fields,
    meta: { epistemeVersion: EPISTEME_VERSION },
  };
  stream.write(`${canonicalJson(envelope)}\n`);
}

function writeHumanSuccess(command, data, warnings) {
  process.stdout.write(`${terminalSafe(renderHumanResult(command, data))}\n`);
  for (const warning of warnings) process.stderr.write(`warning: ${terminalSafe(warning.message)}\n`);
}

function renderHumanResult(command, data) {
  if (command === "snapshot") {
    return [
      `Captured ${data.sources.length} source(s): ${data.counts.captured} new, ${data.counts.unchanged} unchanged, ${data.counts.reused} reused.`,
      `Index: ${data.indexPath}`,
    ].join("\n");
  }
  if (command === "manual-ingest") {
    return `Ingested ${data.sources.length} source(s): ${data.counts.captured} new, ${data.counts.unchanged} unchanged.\nIndex: ${data.indexPath}`;
  }
  if (command === "extract") {
    return `Extracted ${data.counts.documents} document(s) with ${data.counts.warnings} warning(s).\nIndex: ${data.indexPath}`;
  }
  if (command === "chunk") {
    return `Created ${data.counts.chunks} chunk(s) from ${data.counts.documents} document(s).\nIndex: ${data.indexPath}\nNext: episteme index --chunks ${path.dirname(data.indexPath)}`;
  }
  if (command === "index") {
    return data.indexFile
      ? `Indexed ${data.counts.documents} chunk(s) and ${data.counts.terms} term(s).\nIndex: ${data.indexFile}`
      : `Generated an in-memory index with ${data.counts.documents} chunk(s) and ${data.counts.terms} term(s).`;
  }
  if (command === "query") return renderQuery(data);
  if (command === "diff") {
    const summary = data.summary;
    const result = `Documents: ${summary.documents.added} added, ${summary.documents.changed} changed, ${summary.documents.removed} removed.\nSections: ${summary.sections.added} added, ${summary.sections.changed} changed, ${summary.sections.removed} removed.`;
    return data.outputPath ? `${result}\nDiff: ${data.outputPath}` : result;
  }
  if (command === "pipeline") {
    return [
      "Pipeline completed.",
      `Snapshots: ${data.snapshot.sources.length} source(s).`,
      `Documents: ${data.extract.counts.documents}.`,
      `Chunks: ${data.chunk.counts.chunks}.`,
      `Search index: ${data.index.indexFile}`,
    ].join("\n");
  }
  return "Completed successfully.";
}

function renderQuery(data) {
  const lines = [`${data.total} result(s) for “${data.query}” (offset ${data.offset}, limit ${data.limit}).`];
  data.results.forEach((result, index) => {
    const location = `${result.citation.url}${result.citation.fragment || ""}`;
    lines.push(
      "",
      `${data.offset + index + 1}. ${result.heading || "Untitled"} [score ${result.score}] [${result.contentTrust}]`,
      `   ${result.snippet}`,
      `   ${location}`,
      `   snapshot ${result.citation.snapshotId}; chunk ${result.chunkId}`,
    );
  });
  if (data.nextOffset !== null) lines.push("", `Next: --offset ${data.nextOffset}`);
  return lines.join("\n");
}

function writeHumanError(command, error, debug) {
  const lines = [`error: ${error.message}`];
  const hint = error.details?.hint || (command ? `Run 'episteme ${command} --help'.` : "Run 'episteme --help'.");
  if (hint) lines.push(`hint: ${hint}`);
  if (error.retryable) lines.push("This failure is retryable.");
  if (error.code === "INTERNAL_ERROR") {
    lines.push("Rerun with --debug and report this at https://github.com/Ismail-elkorchi/episteme/issues");
  }
  if (debug) {
    for (const cause of debugDetails(error).causes) {
      lines.push("", `${cause.name}: ${cause.message}`, cause.stack || "");
    }
  }
  process.stderr.write(`${terminalSafe(lines.filter(Boolean).join("\n"))}\n`);
}

function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "");
}

function debugDetails(error) {
  const causes = [];
  const seen = new Set();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    causes.push({ name: current.name, message: current.message, stack: current.stack || null });
    current = current.cause;
  }
  return { causes, issueUrl: "https://github.com/Ismail-elkorchi/episteme/issues" };
}

function commandFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--progress") {
      index += 1;
      continue;
    }
    if (
      token === "--json" ||
      token === "--debug" ||
      token === "--help" ||
      token === "-h" ||
      token === "--version" ||
      token.startsWith("--progress=")
    ) {
      continue;
    }
    if (!token.startsWith("-")) return token;
  }
  return null;
}

function installCancellationHandlers() {
  const controller = new AbortController();
  let interruptions = 0;
  const handlers = new Map();
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      interruptions += 1;
      if (interruptions > 1) process.exit(signalName === "SIGTERM" ? 143 : 130);
      controller.abort(signalName);
    };
    handlers.set(signalName, handler);
    process.on(signalName, handler);
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const [signalName, handler] of handlers) process.off(signalName, handler);
    },
  };
}
