import { inputError, limitError } from "./errors.js";
import { readJsonInput } from "./execution.js";

const ALLOWED_KEYS = new Set(["url", "family", "authority", "extractor"]);
const AUTHORITIES = new Set(["normative", "informative"]);
const EXTRACTORS = new Set(["html", "pdf", "text", "xml"]);

export async function loadManifest(manifestPath, {
  maxSources = 1_000,
  maxInputBytes = 64 * 1024 * 1024,
  stdin = process.stdin,
  signal,
} = {}) {
  const data = await readJsonInput(manifestPath, {
    maxBytes: maxInputBytes,
    stdin,
    label: "Manifest",
    signal,
  });
  if (!Array.isArray(data)) {
    throw inputError("Manifest must be a JSON array", { path: manifestPath });
  }
  if (data.length > maxSources) {
    throw limitError(`Manifest contains ${data.length} sources; limit is ${maxSources}`, {
      path: manifestPath,
      actual: data.length,
      limit: maxSources,
    });
  }

  const seen = new Set();
  return data.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw inputError(`Manifest entry ${index} must be an object`, { path: manifestPath, index });
    }
    const unknown = Object.keys(entry).filter((key) => !ALLOWED_KEYS.has(key));
    if (unknown.length > 0) {
      throw inputError(`Manifest entry ${index} has unknown fields: ${unknown.join(", ")}`, {
        path: manifestPath,
        index,
        fields: unknown,
      });
    }
    if (typeof entry.url !== "string" || entry.url.length === 0) {
      throw inputError(`Manifest entry ${index} requires a non-empty URL`, { path: manifestPath, index });
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(entry.url);
    } catch (error) {
      throw inputError(`Manifest entry ${index} has an invalid URL`, {
        path: manifestPath,
        index,
        url: entry.url,
      }, error);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw inputError(`Manifest entry ${index} URL must use HTTP or HTTPS`, {
        path: manifestPath,
        index,
        protocol: parsedUrl.protocol,
      });
    }
    const normalized = parsedUrl.toString();
    if (seen.has(normalized)) {
      throw inputError(`Manifest contains duplicate URL: ${normalized}`, { path: manifestPath, index });
    }
    seen.add(normalized);
    if (entry.family !== undefined && (typeof entry.family !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(entry.family))) {
      throw inputError(`Manifest entry ${index} has an invalid family`, { path: manifestPath, index });
    }
    if (entry.authority !== undefined && !AUTHORITIES.has(entry.authority)) {
      throw inputError(`Manifest entry ${index} has an invalid authority`, { path: manifestPath, index });
    }
    if (entry.extractor !== undefined && !EXTRACTORS.has(entry.extractor)) {
      throw inputError(`Manifest entry ${index} has an invalid extractor`, { path: manifestPath, index });
    }
    return {
      url: normalized,
      family: entry.family ?? null,
      authority: entry.authority ?? null,
      extractor: entry.extractor ?? null,
    };
  });
}
