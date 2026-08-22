import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractXmlDocument } from "../src/extractors/xml.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function collectDefinitionItems(doc) {
  const items = [];
  for (const section of doc.sections || []) {
    for (const block of section.blocks || []) {
      if (block && Array.isArray(block.items)) {
        items.push(...block.items);
      }
    }
  }
  return items;
}

test("extracts facets from the secondary XSD fixture", async () => {
  const schemaPath = path.join(__dirname, "fixtures", "xsd", "secondary-schema.xsd");
  const xmlText = await fs.readFile(schemaPath, "utf8");
  const doc = extractXmlDocument({
    text: xmlText,
    url: "fixture://secondary-schema.xsd",
    family: "synthetic",
    authority: "informative",
    documentType: "xsd",
  });

  const items = collectDefinitionItems(doc);
  const code = items.find((item) => item.term === "simpleType SecondaryCode");
  assert.ok(code, "Expected SecondaryCode simpleType to be extracted");
  assert.ok(
    code.definition.includes("pattern=") &&
      code.definition.includes("minLength=") &&
      code.definition.includes("maxLength="),
    "Expected SecondaryCode facets to include pattern/minLength/maxLength",
  );

  const number = items.find((item) => item.term === "simpleType SecondaryNumber");
  assert.ok(number, "Expected SecondaryNumber simpleType to be extracted");
  assert.ok(
    number.definition.includes("minInclusive=") &&
      number.definition.includes("maxInclusive="),
    "Expected SecondaryNumber facets to include minInclusive/maxInclusive",
  );
});
