import { CONTENT_TRUST, DOCUMENT_SCHEMA_VERSION, EPISTEME_VERSION } from "./constants.js";
import { fingerprintJson } from "./utils.js";

export function createExtractionProvenance({
  source,
  extractor,
  family,
  authority,
  documentType,
  rules,
  fragment,
}) {
  if (typeof source?.sha256 !== "string" || source.sha256.length === 0) {
    throw new TypeError("Extraction requires source.sha256 from a recorded snapshot");
  }
  const configuration = {
    extractor,
    family,
    authority,
    documentType: documentType || null,
    rules: rules || null,
    fragment: fragment || null,
  };
  return {
    producer: "episteme",
    producerVersion: EPISTEME_VERSION,
    extractor,
    configurationSha256: fingerprintJson(configuration),
    sourceSha256: source.sha256,
  };
}

export function documentBase({
  url,
  title,
  family,
  authority,
  documentType,
  snapshotId,
  source,
  provenance,
}) {
  if (!source || typeof source.sha256 !== "string" || source.snapshotId !== snapshotId) {
    throw new TypeError("Recorded source snapshot metadata is required");
  }
  if (!provenance || provenance.sourceSha256 !== source.sha256) {
    throw new TypeError("Extraction provenance must match the recorded source");
  }
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    contentTrust: CONTENT_TRUST,
    url,
    title: title || url,
    family: family || "generic",
    authority: authority || "informative",
    documentType: documentType || null,
    snapshotId,
    source,
    provenance,
  };
}
