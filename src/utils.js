import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic } from "./execution.js";

export function sha256Hex(buffer) {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

export function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

export function fingerprintJson(value) {
  return sha256Hex(Buffer.from(canonicalJson(value), "utf8"));
}

export function withFingerprint(artifact) {
  const { fingerprint: _ignored, ...content } = artifact;
  return { ...content, fingerprint: fingerprintJson(content) };
}

export function hasValidFingerprint(artifact) {
  if (!artifact || typeof artifact.fingerprint !== "string") return false;
  const { fingerprint, ...content } = artifact;
  return fingerprintJson(content) === fingerprint;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, data) {
  await ensureDir(filePath);
  const payload = JSON.stringify(sortJsonValue(data), null, 2) + "\n";
  await writeFileAtomic(filePath, payload, "utf8");
  return {
    bytes: Buffer.byteLength(payload, "utf8"),
    sha256: sha256Hex(Buffer.from(payload, "utf8")),
  };
}

export function normalizeUrlForSnapshot(urlString) {
  const url = new URL(urlString);
  url.hash = "";
  return url.toString();
}

export function extractFragment(urlString) {
  const url = new URL(urlString);
  const fragment = url.hash.replace(/^#/, "");
  return fragment || null;
}

export function getExtensionFromContentType(contentType = "") {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/html") return ".html";
  if (type === "text/markdown") return ".md";
  if (type === "text/plain") return ".txt";
  if (type === "application/json") return ".json";
  if (type === "application/pdf") return ".pdf";
  if (type === "application/zip" || type === "application/x-zip-compressed") return ".zip";
  if (type === "application/xml" || type === "text/xml") return ".xml";
  return ".bin";
}

export function nowIso() {
  return new Date().toISOString();
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }
  return value;
}

export function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function parseCharset(contentType = "") {
  const match = /charset=([^;]+)/i.exec(contentType);
  if (!match) {
    return null;
  }
  const raw = match[1].trim().toLowerCase();
  if (raw === "utf-8" || raw === "utf8") return "utf8";
  if (raw === "us-ascii") return "ascii";
  if (raw === "iso-8859-1") return "latin1";
  return raw;
}
