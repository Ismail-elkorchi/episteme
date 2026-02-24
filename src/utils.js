import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function sha256Hex(buffer) {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

export async function ensureDir(filePath) {
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
  const payload = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, payload, "utf8");
}

export function normalizeUrlForSnapshot(urlString) {
  const url = new URL(urlString);
  url.hash = "";
  return url.toString();
}

export function sanitizeUrlToId(urlString) {
  const url = new URL(urlString);
  const raw = `${url.hostname}${url.pathname}${url.search}${url.hash}`;
  return raw
    .replace(/\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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

export function chunkText(text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLength, text.length);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function stableSectionKey(section, index) {
  if (section.id) {
    return section.id.replace(/\s+/g, "-");
  }
  return `section-${index + 1}`;
}

export function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
