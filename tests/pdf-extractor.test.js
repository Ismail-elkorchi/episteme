import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { extractPdfDocument } from "../src/extractors/pdf.js";
import { assertSchema } from "./helpers/schema-validator.js";
import { buildPdfWithPageContents } from "./helpers/pdf-builder.js";
import { extractionFixture } from "./helpers/extraction-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "minimal.pdf");

test("extracts text from a PDF buffer", async () => {
  const raw = await fs.readFile(fixturePath);
  const buffer = Buffer.from(raw);
  const url = "https://example.test/minimal.pdf";
  const doc = await extractPdfDocument({
    buffer,
    url,
    family: "generic",
    authority: "informative",
    documentType: "pdf",
    ...extractionFixture({
      url,
      content: buffer,
      contentType: "application/pdf",
      extractor: "pdf",
      documentType: "pdf",
    }),
  });

  await assertSchema(doc, "pdf-doc");
  const blocks = doc.sections.flatMap((section) => section.blocks || []);
  const text = blocks.map((block) => block.text || "").join(" ");
  assert.ok(text.includes("Hello PDF"), "Expected extracted PDF text to include 'Hello PDF'");
  assert.equal(doc.provenance.sourceSha256, doc.source.sha256);
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
  const url = "https://example.test/structured.pdf";
  const input = {
    buffer,
    url,
    family: "generic",
    authority: "normative",
    documentType: "pdf",
    ...extractionFixture({
      url,
      content: buffer,
      contentType: "application/pdf",
      extractor: "pdf",
      authority: "normative",
      documentType: "pdf",
    }),
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
  const url = "https://example.test/table.pdf";
  const context = extractionFixture({
    url,
    content: buffer,
    contentType: "application/pdf",
    extractor: "pdf",
    documentType: "pdf",
  });

  const doc = await extractPdfDocument({
    buffer,
    url,
    family: "generic",
    authority: "informative",
    documentType: "pdf",
    ...context,
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
  const buffer = new TextEncoder().encode("not a pdf");
  const url = "https://example.test/invalid.pdf";
  const context = extractionFixture({
    url,
    content: buffer,
    contentType: "application/pdf",
    extractor: "pdf",
    documentType: "pdf",
  });
  const doc = await extractPdfDocument({
    buffer,
    url,
    family: "generic",
    authority: "informative",
    documentType: "pdf",
    ...context,
  });

  await assertSchema(doc, "invalid-pdf-doc");
  assert.equal(doc.provenance.sourceSha256, doc.source.sha256);
  assert.equal(doc.pdf.status, "failed");
  assert.deepEqual(doc.sections, []);
  assert.ok(doc.warnings[0].startsWith("PDF extraction failed"));
});

test("requires recorded source snapshot metadata", async () => {
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
    /Recorded source snapshot metadata is required/u,
  );
});
