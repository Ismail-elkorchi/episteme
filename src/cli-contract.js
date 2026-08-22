import { EPISTEME_VERSION } from "./constants.js";
import { usageError } from "./errors.js";

const MANIFEST_INPUT_LIMIT = 64 * 1024 * 1024;
const INDEX_INPUT_LIMIT = 512 * 1024 * 1024;

const pathOption = (description, defaultValue) => ({
  type: "path",
  description,
  ...(defaultValue === undefined ? { required: true } : { default: defaultValue }),
});

const booleanOption = (description) => ({ type: "boolean", description, default: false });

const integerOption = (description, defaultValue, minimum, maximum) => ({
  type: "integer",
  description,
  default: defaultValue,
  minimum,
  maximum,
});

export const COMMANDS = Object.freeze({
  snapshot: {
    description: "Capture bounded HTTP snapshots for every manifest source.",
    usage: "episteme snapshot [options]",
    examples: ["episteme snapshot --manifest ./manifest.json", "episteme snapshot --reuse"],
    options: {
      manifest: pathOption("Source manifest JSON file, or - for stdin.", "manifest.json"),
      out: pathOption("Snapshot directory.", "snapshots"),
      reuse: booleanOption("Use recorded snapshots without network requests."),
      "allow-localhost": {
        ...booleanOption("Allow loopback and localhost snapshot targets."),
        key: "allowLocalhost",
      },
      "allow-private-networks": {
        ...booleanOption("Allow private-use network targets; localhost remains separate."),
        key: "allowPrivateNetworks",
      },
      timeout: integerOption("Per-request timeout in milliseconds.", 60_000, 1, 600_000),
      "max-bytes": {
        ...integerOption("Maximum response bytes per source.", 25 * 1024 * 1024, 1, 1024 * 1024 * 1024),
        key: "maxBytes",
      },
      retries: integerOption("Retries for transient HTTP failures.", 2, 0, 8),
      "max-sources": {
        ...integerOption("Maximum manifest entries accepted.", 1_000, 1, 100_000),
        key: "maxSources",
      },
      "max-input-bytes": {
        ...integerOption("Maximum manifest input bytes.", MANIFEST_INPUT_LIMIT, 1, 1024 * 1024 * 1024),
        key: "maxInputBytes",
      },
    },
  },
  "manual-ingest": {
    description: "Capture bounded local files as content-addressed snapshots.",
    usage: "episteme manual-ingest --map <path|-> [options]",
    examples: ["episteme manual-ingest --map ./manual-ingest.json"],
    options: {
      map: pathOption("Manual-ingest map JSON file, or - for stdin."),
      snapshots: pathOption("Snapshot directory.", "snapshots"),
      "max-bytes": {
        ...integerOption("Maximum bytes per local source.", 25 * 1024 * 1024, 1, 1024 * 1024 * 1024),
        key: "maxBytes",
      },
      "max-sources": {
        ...integerOption("Maximum map entries accepted.", 1_000, 1, 100_000),
        key: "maxSources",
      },
      "max-input-bytes": {
        ...integerOption("Maximum map input bytes.", MANIFEST_INPUT_LIMIT, 1, 1024 * 1024 * 1024),
        key: "maxInputBytes",
      },
    },
  },
  extract: {
    description: "Deterministically extract indexed JSON documents from recorded snapshots.",
    usage: "episteme extract [options]",
    examples: ["episteme extract --manifest ./manifest.json --snapshots ./snapshots --out ./specs"],
    options: {
      manifest: pathOption("Source manifest JSON file, or - for stdin.", "manifest.json"),
      snapshots: pathOption("Snapshot directory.", "snapshots"),
      out: pathOption("Extracted-document directory.", "specs"),
      "max-sources": {
        ...integerOption("Maximum manifest entries accepted.", 1_000, 1, 100_000),
        key: "maxSources",
      },
      "max-input-bytes": {
        ...integerOption("Maximum manifest input bytes.", MANIFEST_INPUT_LIMIT, 1, 1024 * 1024 * 1024),
        key: "maxInputBytes",
      },
    },
  },
  chunk: {
    description: "Create bounded, attributable chunks from an extracted-document index.",
    usage: "episteme chunk [options]",
    examples: ["episteme chunk --input ./specs --out ./chunks"],
    options: {
      input: pathOption("Extracted-document directory.", "specs"),
      out: pathOption("Chunk directory.", "chunks"),
      "max-chars": {
        ...integerOption("Maximum characters in one chunk.", 6_000, 256, 100_000),
        key: "maxChars",
      },
      "overlap-chars": {
        ...integerOption("Character overlap between split block chunks.", 400, 0, 10_000),
        key: "overlapChars",
      },
    },
  },
  index: {
    description: "Build a deterministic lexical search index from chunks.",
    usage: "episteme index [options]",
    examples: ["episteme index --chunks ./chunks", "episteme index --out - --json"],
    options: {
      chunks: pathOption("Chunk directory.", "chunks"),
      out: pathOption("Search-index JSON file, or - with --json.", "chunks/search-index.json"),
    },
  },
  query: {
    description: "Return bounded, ranked evidence with source citations.",
    usage: "episteme query --term <query> [options]",
    examples: ["episteme query --term \"popover algorithm\" --limit 5"],
    options: {
      index: pathOption("Search-index JSON file, or - for stdin.", "chunks/search-index.json"),
      term: { type: "string", description: "Lexical search query.", required: true, minLength: 1 },
      family: { type: "string", description: "Exact family filter." },
      authority: {
        type: "enum",
        values: ["normative", "informative"],
        description: "Authority filter.",
      },
      "document-type": { type: "string", key: "documentType", description: "Document-type filter." },
      normativity: { type: "string", description: "Block normativity filter." },
      limit: integerOption("Maximum returned results.", 10, 1, 100),
      offset: integerOption("Result offset for deterministic pagination.", 0, 0, 1_000_000),
      "max-chars": {
        ...integerOption("Maximum snippet characters per result.", 1_200, 80, 20_000),
        key: "maxChars",
      },
      "max-input-bytes": {
        ...integerOption("Maximum search-index input bytes.", INDEX_INPUT_LIMIT, 1, 1024 * 1024 * 1024),
        key: "maxInputBytes",
      },
    },
  },
  diff: {
    description: "Compare complete extracted-document corpora.",
    usage: "episteme diff --from <directory> --to <directory> [options]",
    examples: ["episteme diff --from ./specs-old --to ./specs", "episteme diff --from old --to new --out - --json"],
    options: {
      from: pathOption("Previous extracted-document directory."),
      to: pathOption("Current extracted-document directory."),
      out: pathOption("Diff output directory, or - with --json.", "diffs"),
    },
  },
  pipeline: {
    description: "Run snapshot, extract, chunk, and index with one bounded invocation.",
    usage: "episteme pipeline [options]",
    examples: ["episteme pipeline --manifest ./manifest.json"],
    options: {
      manifest: pathOption("Source manifest JSON file, or - for stdin.", "manifest.json"),
      snapshots: pathOption("Snapshot directory.", "snapshots"),
      specs: pathOption("Extracted-document directory.", "specs"),
      chunks: pathOption("Chunk directory.", "chunks"),
      reuse: booleanOption("Use recorded snapshots without network requests."),
      "allow-localhost": {
        ...booleanOption("Allow loopback and localhost snapshot targets."),
        key: "allowLocalhost",
      },
      "allow-private-networks": {
        ...booleanOption("Allow private-use network targets; localhost remains separate."),
        key: "allowPrivateNetworks",
      },
      timeout: integerOption("Per-request timeout in milliseconds.", 60_000, 1, 600_000),
      "max-bytes": {
        ...integerOption("Maximum response bytes per source.", 25 * 1024 * 1024, 1, 1024 * 1024 * 1024),
        key: "maxBytes",
      },
      retries: integerOption("Retries for transient HTTP failures.", 2, 0, 8),
      "max-sources": {
        ...integerOption("Maximum manifest entries accepted.", 1_000, 1, 100_000),
        key: "maxSources",
      },
      "max-input-bytes": {
        ...integerOption("Maximum manifest input bytes.", MANIFEST_INPUT_LIMIT, 1, 1024 * 1024 * 1024),
        key: "maxInputBytes",
      },
      "max-chars": {
        ...integerOption("Maximum characters in one chunk.", 6_000, 256, 100_000),
        key: "maxChars",
      },
      "overlap-chars": {
        ...integerOption("Character overlap between split block chunks.", 400, 0, 10_000),
        key: "overlapChars",
      },
    },
  },
});

export function parseInvocation(argv) {
  const { tokens, global, help, version } = extractGlobalOptions(argv);
  if (help || tokens[0] === "help") {
    const candidate = tokens[0] === "help" ? tokens[1] : tokens.find((token) => COMMANDS[token]);
    if (tokens[0] === "help" && tokens.length > 2) {
      throw usageError("help accepts at most one command name");
    }
    if (tokens[0] === "help" && candidate && !COMMANDS[candidate]) {
      throw unknownCommand(candidate);
    }
    return { action: "help", command: candidate || null, options: {}, global };
  }
  if (version) return { action: "version", command: "version", options: {}, global };
  if (tokens.length === 0) return { action: "help", command: null, options: {}, global };

  const [command, ...commandTokens] = tokens;
  const definition = COMMANDS[command];
  if (!definition) throw unknownCommand(command);
  const options = parseCommandOptions(command, definition, commandTokens);
  if (options.overlapChars !== undefined && options.maxChars !== undefined && options.overlapChars >= options.maxChars) {
    throw usageError("--overlap-chars must be smaller than --max-chars", { command });
  }
  if ((command === "index" || command === "diff") && options.out === "-" && !global.json) {
    throw usageError(`${command} --out - requires --json`, { command, option: "out" });
  }
  return { action: "run", command, options, global };
}

export function detectGlobalIntent(argv) {
  return {
    json: argv.includes("--json"),
    debug: argv.includes("--debug"),
  };
}

export function renderHelp(command = null) {
  if (!command) {
    const commands = Object.entries(COMMANDS)
      .map(([name, definition]) => `  ${name.padEnd(15)} ${definition.description}`)
      .join("\n");
    return [
      `Episteme ${EPISTEME_VERSION} — deterministic, attributable evidence for agents and people.`,
      "",
      "Usage:",
      "  episteme <command> [options]",
      "  episteme help <command>",
      "",
      "Commands:",
      commands,
      "",
      "Global options:",
      "  -h, --help                 Show help.",
      "  --version                  Show the installed version.",
      "  --json                     Emit the schema-versioned JSON envelope.",
      "  --debug                    Include cause chains for failures.",
      "  --progress <mode>          auto, always, or never (default: auto).",
      "",
      "Examples:",
      "  episteme pipeline --manifest ./manifest.json",
      "  episteme query --term \"popover algorithm\" --limit 5",
      "  episteme query --term evidence --json",
      "",
      "Documentation: https://github.com/Ismail-elkorchi/episteme",
      "Issues: https://github.com/Ismail-elkorchi/episteme/issues",
    ].join("\n");
  }
  const definition = COMMANDS[command];
  if (!definition) throw unknownCommand(command);
  const options = Object.entries(definition.options)
    .map(([name, option]) => renderOption(name, option))
    .join("\n");
  return [
    definition.description,
    "",
    "Usage:",
    `  ${definition.usage}`,
    "",
    "Options:",
    options || "  (none)",
    "  -h, --help                 Show this help.",
    "  --json                     Emit the JSON envelope.",
    "  --debug                    Include cause chains for failures.",
    "  --progress <mode>          auto, always, or never (default: auto).",
    "",
    "Examples:",
    ...definition.examples.map((example) => `  ${example}`),
    "",
    "Documentation: https://github.com/Ismail-elkorchi/episteme",
    "Issues: https://github.com/Ismail-elkorchi/episteme/issues",
  ].join("\n");
}

function extractGlobalOptions(argv) {
  const global = { json: false, debug: false, progress: "auto" };
  const tokens = [];
  let help = false;
  let version = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") global.json = true;
    else if (token === "--debug") global.debug = true;
    else if (token === "--help" || token === "-h") help = true;
    else if (token === "--version") version = true;
    else if (token === "--progress" || token.startsWith("--progress=")) {
      const value = token === "--progress" ? argv[++index] : token.slice("--progress=".length);
      if (!value || !["auto", "always", "never"].includes(value)) {
        throw usageError("--progress must be one of: auto, always, never", { option: "progress" });
      }
      global.progress = value;
    } else tokens.push(token);
  }
  return { tokens, global, help, version };
}

function parseCommandOptions(command, definition, tokens) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || token === "--") {
      throw usageError(`Unexpected positional argument: ${token}`, { command });
    }
    const separator = token.indexOf("=");
    const flag = token.slice(2, separator === -1 ? undefined : separator);
    const option = definition.options[flag];
    if (!option) throw usageError(`Unknown option for ${command}: --${flag}`, optionHint(command, flag));
    if (seen.has(flag)) throw usageError(`Duplicate option: --${flag}`, { command, option: flag });
    seen.add(flag);
    let rawValue = separator === -1 ? undefined : token.slice(separator + 1);
    if (option.type === "boolean") {
      if (rawValue !== undefined) throw usageError(`--${flag} does not take a value`, { command, option: flag });
      options[option.key || flag] = true;
      continue;
    }
    if (rawValue === undefined) rawValue = tokens[++index];
    if (rawValue === undefined || rawValue.startsWith("--")) {
      throw usageError(`--${flag} requires a value`, { command, option: flag });
    }
    options[option.key || flag] = parseOptionValue(command, flag, option, rawValue);
  }
  for (const [flag, option] of Object.entries(definition.options)) {
    const key = option.key || flag;
    if (options[key] === undefined && Object.hasOwn(option, "default")) options[key] = option.default;
    if (option.required && options[key] === undefined) {
      throw usageError(`${command} requires --${flag}`, { command, option: flag, hint: `Run 'episteme ${command} --help'.` });
    }
  }
  return options;
}

function parseOptionValue(command, flag, option, rawValue) {
  if (option.type === "integer") {
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < option.minimum || value > option.maximum) {
      throw usageError(`--${flag} must be an integer from ${option.minimum} through ${option.maximum}`, {
        command,
        option: flag,
      });
    }
    return value;
  }
  if (option.type === "enum" && !option.values.includes(rawValue)) {
    throw usageError(`--${flag} must be one of: ${option.values.join(", ")}`, { command, option: flag });
  }
  if (option.minLength && rawValue.length < option.minLength) {
    throw usageError(`--${flag} must not be empty`, { command, option: flag });
  }
  return rawValue;
}

function renderOption(name, option) {
  const value = option.type === "boolean" ? "" : ` <${option.type === "enum" ? option.values.join("|") : option.type}>`;
  const details = [];
  if (option.required) details.push("required");
  if (Object.hasOwn(option, "default")) details.push(`default: ${option.default}`);
  if (option.type === "integer") details.push(`range: ${option.minimum}–${option.maximum}`);
  const suffix = details.length > 0 ? ` (${details.join("; ")})` : "";
  return `  ${`--${name}${value}`.padEnd(31)} ${option.description}${suffix}`;
}

function unknownCommand(command) {
  const suggestion = closest(command, Object.keys(COMMANDS));
  return usageError(`Unknown command: ${command}`, {
    command,
    ...(suggestion ? { hint: `Did you mean '${suggestion}'?` } : { hint: "Run 'episteme --help'." }),
  });
}

function optionHint(command, flag) {
  const suggestion = closest(flag, Object.keys(COMMANDS[command].options));
  return {
    command,
    option: flag,
    hint: suggestion ? `Did you mean '--${suggestion}'?` : `Run 'episteme ${command} --help'.`,
  };
}

function closest(value, candidates) {
  let best = null;
  let distance = Infinity;
  for (const candidate of candidates) {
    const current = editDistance(value, candidate);
    if (current < distance) {
      best = candidate;
      distance = current;
    }
  }
  return distance <= Math.max(2, Math.floor(value.length / 3)) ? best : null;
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}
