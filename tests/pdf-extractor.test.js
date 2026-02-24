import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { extractPdfDocument } from "../src/extractors/pdf.js";
import { assertSchema } from "./helpers/schema-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "minimal.pdf");

async function testPdfExtraction() {
  const raw = await fs.readFile(fixturePath);
  const buffer = Buffer.from(raw);
  const doc = await extractPdfDocument({
    buffer,
    url: "https://example.test/minimal.pdf",
    family: "generic",
    authority: "informative",
    documentType: "pdf",
  });

  await assertSchema(doc, "pdf-doc");
  const blocks = doc.sections.flatMap((section) => section.blocks || []);
  const text = blocks.map((block) => block.text || "").join(" ");
  assert.ok(text.includes("Hello PDF"), "Expected extracted PDF text to include 'Hello PDF'");
  assert.ok(
    !(doc.warnings || []).some((warning) => warning.includes("Uint8Array")),
    "Expected PDF extraction to normalize Buffer input",
  );
}

async function run() {
  await testPdfExtraction();
  console.log("pdf-extractor tests passed");
}

run().catch((error) => {
  console.error("pdf-extractor tests failed", error);
  process.exit(1);
});
