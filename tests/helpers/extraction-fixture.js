import { Buffer } from "node:buffer";
import { createExtractionProvenance } from "../../src/document.js";
import { fingerprintJson, sha256Hex } from "../../src/utils.js";

export function extractionFixture({
  url,
  content,
  contentType,
  extractor,
  family = "generic",
  authority = "informative",
  documentType = null,
  rules = null,
  fragment = null,
}) {
  const bytes = content instanceof Uint8Array
    ? Buffer.from(content)
    : Buffer.from(String(content ?? ""), "utf8");
  const sourceCore = {
    sourceUrl: url,
    finalUrl: url,
    contentType,
    charset: contentType.includes("charset=utf-8") ? "utf8" : null,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
  const snapshotId = fingerprintJson(sourceCore);
  const source = {
    schemaVersion: "1",
    snapshotId,
    ...sourceCore,
    fetchedAt: "2026-08-22T00:00:00.000Z",
    fileName: fileNameFor(contentType),
    etag: null,
    lastModified: null,
  };
  const provenance = createExtractionProvenance({
    source,
    extractor,
    family,
    authority,
    documentType,
    rules,
    fragment,
  });
  return { snapshotId, source, provenance };
}

function fileNameFor(contentType) {
  if (contentType.startsWith("text/html")) return "content.html";
  if (contentType.includes("xml")) return "content.xml";
  if (contentType === "application/pdf") return "content.pdf";
  return "content.txt";
}
