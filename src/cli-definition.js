import {
  createCli,
  createCliHelp,
  formatCliHelp,
  inspectCliArgv,
  value,
} from "clivoke";
import { EPISTEME_VERSION } from "./constants.js";
import { usageError } from "./errors.js";

const MANIFEST_INPUT_LIMIT = 64 * 1024 * 1024;
const INDEX_INPUT_LIMIT = 512 * 1024 * 1024;

const pathOption = (flag, description, defaultValue) => ({
  type: "string",
  flags: [`--${flag}`],
  valueLabel: "path",
  description,
  ...(defaultValue === undefined ? { required: true } : { default: defaultValue }),
});

const booleanOption = (flag, description) => ({
  type: "boolean",
  flags: [`--${flag}`],
  description,
  default: false,
});

const integerOption = (flag, description, defaultValue, minimum, maximum) => ({
  type: value.integer({ minimum, maximum }),
  flags: [`--${flag}`],
  valueLabel: "integer",
  description: `${description} Range: ${minimum}–${maximum}.`,
  default: defaultValue,
});

const sourceBounds = {
  maxSources: integerOption("max-sources", "Maximum input entries accepted.", 1_000, 1, 100_000),
  maxInputBytes: integerOption(
    "max-input-bytes",
    "Maximum input bytes.",
    MANIFEST_INPUT_LIMIT,
    1,
    1024 * 1024 * 1024,
  ),
};

const networkOptions = {
  reuse: booleanOption("reuse", "Use recorded snapshots without network requests."),
  allowLocalhost: booleanOption(
    "allow-localhost",
    "Allow loopback and localhost snapshot targets.",
  ),
  allowPrivateNetworks: booleanOption(
    "allow-private-networks",
    "Allow private-use network targets; localhost remains separate.",
  ),
  timeout: integerOption(
    "timeout",
    "Per-request timeout in milliseconds.",
    60_000,
    1,
    600_000,
  ),
  maxBytes: integerOption(
    "max-bytes",
    "Maximum response bytes per source.",
    25 * 1024 * 1024,
    1,
    1024 * 1024 * 1024,
  ),
  retries: integerOption("retries", "Retries for transient HTTP failures.", 2, 0, 8),
};

const chunkOptions = {
  maxChars: integerOption(
    "max-chars",
    "Maximum characters in one chunk.",
    6_000,
    256,
    100_000,
  ),
  overlapChars: integerOption(
    "overlap-chars",
    "Character overlap between split block chunks.",
    400,
    0,
    10_000,
  ),
};

export const EPISTEME_CLI = createCli({
  name: "episteme",
  version: EPISTEME_VERSION,
  description: "Deterministic, attributable evidence for agents and people.",
  invokable: false,
  options: {
    json: booleanOption("json", "Emit the schema-versioned JSON envelope."),
    debug: booleanOption("debug", "Include cause chains for failures."),
    progress: {
      type: value.choice(["auto", "always", "never"]),
      flags: ["--progress"],
      valueLabel: "mode",
      description: "Control progress reporting on stderr.",
      default: "auto",
    },
  },
  examples: [
    { usage: "episteme pipeline --manifest ./manifest.json" },
    { usage: "episteme query --term \"popover algorithm\" --limit 5" },
    { usage: "episteme query --term evidence --json" },
  ],
  commands: [
    {
      name: "snapshot",
      description: "Capture bounded HTTP snapshots for every manifest source.",
      examples: [
        { usage: "episteme snapshot --manifest ./manifest.json" },
        { usage: "episteme snapshot --reuse" },
      ],
      options: {
        manifest: pathOption("manifest", "Source manifest JSON file, or - for stdin.", "manifest.json"),
        out: pathOption("out", "Snapshot directory.", "snapshots"),
        ...networkOptions,
        ...sourceBounds,
      },
    },
    {
      name: "manual-ingest",
      description: "Capture bounded local files as content-addressed snapshots.",
      examples: [{ usage: "episteme manual-ingest --map ./manual-ingest.json" }],
      options: {
        map: pathOption("map", "Manual-ingest map JSON file, or - for stdin."),
        snapshots: pathOption("snapshots", "Snapshot directory.", "snapshots"),
        maxBytes: integerOption(
          "max-bytes",
          "Maximum bytes per local source.",
          25 * 1024 * 1024,
          1,
          1024 * 1024 * 1024,
        ),
        ...sourceBounds,
      },
    },
    {
      name: "extract",
      description: "Deterministically extract indexed JSON documents from recorded snapshots.",
      examples: [{
        usage: "episteme extract --manifest ./manifest.json --snapshots ./snapshots --out ./specs",
      }],
      options: {
        manifest: pathOption("manifest", "Source manifest JSON file, or - for stdin.", "manifest.json"),
        snapshots: pathOption("snapshots", "Snapshot directory.", "snapshots"),
        out: pathOption("out", "Extracted-document directory.", "specs"),
        ...sourceBounds,
      },
    },
    {
      name: "chunk",
      description: "Create bounded, attributable chunks from an extracted-document index.",
      examples: [{ usage: "episteme chunk --input ./specs --out ./chunks" }],
      options: {
        input: pathOption("input", "Extracted-document directory.", "specs"),
        out: pathOption("out", "Chunk directory.", "chunks"),
        ...chunkOptions,
      },
    },
    {
      name: "index",
      description: "Build a deterministic lexical search index from chunks.",
      examples: [
        { usage: "episteme index --chunks ./chunks" },
        { usage: "episteme index --out - --json" },
      ],
      options: {
        chunks: pathOption("chunks", "Chunk directory.", "chunks"),
        out: pathOption("out", "Search-index JSON file, or - with --json.", "chunks/search-index.json"),
      },
    },
    {
      name: "query",
      description: "Return bounded, ranked evidence with source citations.",
      examples: [{ usage: "episteme query --term \"popover algorithm\" --limit 5" }],
      options: {
        index: pathOption("index", "Search-index JSON file, or - for stdin.", "chunks/search-index.json"),
        term: {
          type: "string",
          flags: ["--term"],
          valueLabel: "query",
          description: "Lexical search query.",
          required: true,
        },
        family: { type: "string", flags: ["--family"], description: "Exact family filter." },
        authority: {
          type: value.choice(["normative", "informative"]),
          flags: ["--authority"],
          description: "Authority filter.",
        },
        documentType: {
          type: "string",
          flags: ["--document-type"],
          description: "Document-type filter.",
        },
        normativity: {
          type: "string",
          flags: ["--normativity"],
          description: "Block normativity filter.",
        },
        limit: integerOption("limit", "Maximum returned results.", 10, 1, 100),
        offset: integerOption(
          "offset",
          "Result offset for deterministic pagination.",
          0,
          0,
          1_000_000,
        ),
        maxChars: integerOption(
          "max-chars",
          "Maximum snippet characters per result.",
          1_200,
          80,
          20_000,
        ),
        maxInputBytes: integerOption(
          "max-input-bytes",
          "Maximum search-index input bytes.",
          INDEX_INPUT_LIMIT,
          1,
          1024 * 1024 * 1024,
        ),
      },
    },
    {
      name: "diff",
      description: "Compare complete extracted-document corpora.",
      examples: [
        { usage: "episteme diff --from ./specs-old --to ./specs" },
        { usage: "episteme diff --from old --to new --out - --json" },
      ],
      options: {
        from: pathOption("from", "Previous extracted-document directory."),
        to: pathOption("to", "Current extracted-document directory."),
        out: pathOption("out", "Diff output directory, or - with --json.", "diffs"),
      },
    },
    {
      name: "pipeline",
      description: "Run snapshot, extract, chunk, and index with one bounded invocation.",
      examples: [{ usage: "episteme pipeline --manifest ./manifest.json" }],
      options: {
        manifest: pathOption("manifest", "Source manifest JSON file, or - for stdin.", "manifest.json"),
        snapshots: pathOption("snapshots", "Snapshot directory.", "snapshots"),
        specs: pathOption("specs", "Extracted-document directory.", "specs"),
        chunks: pathOption("chunks", "Chunk directory.", "chunks"),
        ...networkOptions,
        ...sourceBounds,
        ...chunkOptions,
      },
    },
  ],
});

export function parseInvocation(argv) {
  const result = EPISTEME_CLI.parse({ argv });
  if (result.status === "help") {
    return {
      action: "help",
      command: result.commandPath[0] ?? null,
      options: Object.freeze({}),
      global: inspectGlobalOptions(argv),
    };
  }
  if (result.status === "version") {
    return {
      action: "version",
      command: "version",
      options: Object.freeze({}),
      global: inspectGlobalOptions(argv),
    };
  }
  if (result.status === "invalid") throw invalidUsage(result);

  const command = result.command.path[0];
  if (command === undefined) throw new Error("Clivoke selected the non-invokable root command.");
  const { json, debug, progress, ...options } = result.optionValues;
  validateCommandOptions(command, options, Boolean(json));
  return {
    action: "run",
    command,
    options: Object.freeze(options),
    global: Object.freeze({ json: Boolean(json), debug: Boolean(debug), progress }),
  };
}

export function inspectGlobalOptions(argv) {
  const inspection = inspectCliArgv(EPISTEME_CLI, argv);
  const names = new Set(inspection.options.map((option) => option.option));
  return Object.freeze({ json: names.has("json"), debug: names.has("debug") });
}

export function commandFromArgv(argv) {
  const inspection = inspectCliArgv(EPISTEME_CLI, argv);
  return inspection.commandPath[0] ?? inspection.positionalArguments[0]?.value ?? null;
}

export function renderHelp(command = null) {
  const help = createCliHelp(EPISTEME_CLI, command === null ? [] : [command]);
  if (help === undefined) throw usageError(`Unknown command: ${command}`);
  const title = command === null ? `Episteme ${EPISTEME_VERSION}\n\n` : "";
  return [
    `${title}${formatCliHelp(help)}`,
    "",
    "Documentation: https://github.com/Ismail-elkorchi/episteme",
    "Issues: https://github.com/Ismail-elkorchi/episteme/issues",
  ].join("\n");
}

function validateCommandOptions(command, options, json) {
  if ((command === "chunk" || command === "pipeline") && options.overlapChars >= options.maxChars) {
    throw usageError("--overlap-chars must be smaller than --max-chars", { command });
  }
  if ((command === "index" || command === "diff") && options.out === "-" && !json) {
    throw usageError(`${command} --out - requires --json`, { command, option: "out" });
  }
}

function invalidUsage(result) {
  const diagnostic = result.diagnostics.find((candidate) => candidate.severity === "error") ??
    result.diagnostics[0];
  const command = result.command?.path[0];
  const option = diagnostic && "option" in diagnostic ? diagnostic.option : undefined;
  const suggestions = diagnostic && "suggestions" in diagnostic ? diagnostic.suggestions : undefined;
  const suggestion = suggestions?.[0];
  const hint = suggestion
    ? `Did you mean '${suggestion}'?`
    : command
      ? `Run 'episteme ${command} --help'.`
      : "Run 'episteme --help'.";
  return usageError(diagnostic?.message ?? "Invalid command invocation.", {
    ...(command === undefined ? {} : { command }),
    ...(option === undefined ? {} : { option }),
    hint,
  });
}
