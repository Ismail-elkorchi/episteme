import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { extractPdfDocument } from "../src/extractors/pdf.js";
import { assertSchema } from "./helpers/schema-validator.js";
import { buildPdfWithPageContents } from "./helpers/pdf-builder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "minimal.pdf");
const fetchedAt = "2026-08-22T00:00:00.000Z";

test("extracts text from a PDF buffer", async () => {
  const raw = await fs.readFile(fixturePath);
  const buffer = Buffer.from(raw);
  const doc = await extractPdfDocument({
    buffer,
    url: "https://example.test/minimal.pdf",
    family: "generic",
    authority: "informative",
    documentType: "pdf",
    snapshotId: "minimal-snapshot",
    source: {
      snapshotId: "minimal-snapshot",
      sourceUrl: "https://example.test/minimal.pdf",
      finalUrl: "https://example.test/minimal.pdf",
      contentType: "application/pdf",
      charset: null,
      bytes: raw.byteLength,
      sha256: "fixture-sha256",
      fetchedAt,
      fileName: "content.pdf",
    },
  });

  await assertSchema(doc, "pdf-doc");
  const blocks = doc.sections.flatMap((section) => section.blocks || []);
  const text = blocks.map((block) => block.text || "").join(" ");
  assert.ok(text.includes("Hello PDF"), "Expected extracted PDF text to include 'Hello PDF'");
  assert.equal(doc.extractedAt, fetchedAt);
  assert.equal(doc.pdf.engine, "@ismail-elkorchi/pdf-engine");
  assert.equal(doc.pdf.engineVersion, "0.1.0");
  assert.equal(doc.pdf.pageCount, 1);
  assert.equal(doc.pdf.status, "completed");
  assert.deepEqual(blocks[0].source.pageNumbers, [1]);
  assert.equal(blocks[0].source.citations[0].text, "Hello PDF");
  assert.ok(!doc.pdf.knownLimits.includes("table-projection-not-implemented"));
  assert.deepEqual(doc.warnings, []);
});

test("preserves ordered sections and page provenance", async () => {
  const buffer = buildPdfWithPageContents([
    [
      "BT",
      "/F1 24 Tf",
      "1 0 0 1 72 720 Tm",
      "(Overview) Tj",
      "/F1 12 Tf",
      "0 -36 Td",
      "(First paragraph.) Tj",
      "ET",
    ].join("\n"),
    [
      "BT",
      "/F1 24 Tf",
      "1 0 0 1 72 720 Tm",
      "(Details) Tj",
      "/F1 12 Tf",
      "0 -36 Td",
      "(Second paragraph.) Tj",
      "ET",
    ].join("\n"),
  ]);
  const input = {
    buffer,
    url: "https://example.test/structured.pdf",
    family: "generic",
    authority: "normative",
    snapshotId: "structured-snapshot",
    source: {
      snapshotId: "structured-snapshot",
      sourceUrl: "https://example.test/structured.pdf",
      finalUrl: "https://example.test/structured.pdf",
      contentType: "application/pdf",
      charset: null,
      bytes: buffer.byteLength,
      sha256: "structured-sha256",
      fetchedAt,
      fileName: "content.pdf",
    },
    documentType: "pdf",
  };

  const first = await extractPdfDocument(input);
  const second = await extractPdfDocument(input);

  await assertSchema(first, "structured-pdf-doc");
  assert.deepEqual(second, first);
  assert.deepEqual(first.sections.map((section) => section.heading), ["Overview", "Details"]);
  assert.deepEqual(
    first.sections.map((section) => section.blocks[0].text),
    ["First paragraph.", "Second paragraph."],
  );
  assert.deepEqual(
    first.sections.map((section) => section.blocks[0].source.pageNumbers),
    [[1], [2]],
  );
  assert.deepEqual(
    first.sections.map((section) => section.blocks[0].source.citations[0].sourceSpan.text),
    ["First paragraph.", "Second paragraph."],
  );
});

test("projects tables without duplicating their source rows", async () => {
  const buffer = buildPdfWithPageContents([[
    "BT",
    "/F1 12 Tf",
    "72 740 Td",
    "(Measurements) Tj",
    "0 -18 Td",
    "(Specimen Nominal Width Measured Width Result) Tj",
    "0 -18 Td",
    "(Alpha 10.0 mm 10.4 mm pass) Tj",
    "0 -18 Td",
    "(Beta 12.0 mm 11.1 mm review) Tj",
    "0 -18 Td",
    "(Gamma 8.0 mm 8.0 mm pass) Tj",
    "ET",
  ].join("\n")]);
  const source = {
    snapshotId: "table-snapshot",
    sourceUrl: "https://example.test/table.pdf",
    finalUrl: "https://example.test/table.pdf",
    contentType: "application/pdf",
    charset: null,
    bytes: buffer.byteLength,
    sha256: "table-sha256",
    fetchedAt,
    fileName: "content.pdf",
  };

  const doc = await extractPdfDocument({
    buffer,
    url: source.sourceUrl,
    family: "generic",
    authority: "informative",
    snapshotId: source.snapshotId,
    source,
    documentType: "pdf",
  });

  await assertSchema(doc, "table-pdf-doc");
  const blocks = doc.sections.flatMap((section) => section.blocks);
  const tables = blocks.filter((block) => block.type === "table");
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ["Specimen", "Nominal Width", "Measured Width", "Result"]);
  assert.deepEqual(tables[0].rows, [
    ["Alpha", "10.0 mm", "10.4 mm", "pass"],
    ["Beta", "12.0 mm", "11.1 mm", "review"],
    ["Gamma", "8.0 mm", "8.0 mm", "pass"],
  ]);
  assert.ok(tables[0].cells.every((cell) => cell.source.citations.length > 0));
  assert.equal(blocks.filter((block) => block.text?.includes("Alpha 10.0 mm")).length, 0);
});

test("returns deterministic structured diagnostics for malformed PDFs", async () => {
  const source = {
    snapshotId: "invalid-snapshot",
    sourceUrl: "https://example.test/invalid.pdf",
    finalUrl: "https://example.test/invalid.pdf",
    contentType: "application/pdf",
    charset: null,
    bytes: 9,
    sha256: "invalid-sha256",
    fetchedAt,
    fileName: "content.pdf",
  };
  const doc = await extractPdfDocument({
    buffer: new TextEncoder().encode("not a pdf"),
    url: source.sourceUrl,
    family: "generic",
    authority: "informative",
    snapshotId: source.snapshotId,
    source,
    documentType: "pdf",
  });

  await assertSchema(doc, "invalid-pdf-doc");
  assert.equal(doc.extractedAt, fetchedAt);
  assert.equal(doc.pdf.status, "failed");
  assert.deepEqual(doc.sections, []);
  assert.ok(doc.warnings[0].startsWith("PDF extraction failed"));
});

test("requires recorded snapshot time", async () => {
  await assert.rejects(
    extractPdfDocument({
      buffer: new Uint8Array(),
      url: "https://example.test/missing-source.pdf",
      family: "generic",
      authority: "informative",
      snapshotId: "missing-source",
      source: null,
      documentType: "pdf",
    }),
    /requires source\.fetchedAt from the recorded snapshot/u,
  );
});
