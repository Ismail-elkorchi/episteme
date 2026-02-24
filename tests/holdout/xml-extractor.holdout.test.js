import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractXmlDocument } from "../../src/extractors/xml.js";

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

async function run() {
  const schemaPath = path.join(__dirname, "..", "fixtures", "holdout", "holdout-schema.xsd");
  const xmlText = await fs.readFile(schemaPath, "utf8");
  const doc = extractXmlDocument({
    text: xmlText,
    url: "holdout://schema.xsd",
    family: "holdout",
    authority: "informative",
    documentType: "xsd",
  });

  const items = collectDefinitionItems(doc);
  const holdoutCode = items.find((item) => item.term === "simpleType HoldoutCode");
  assert.ok(holdoutCode, "Expected HoldoutCode simpleType to be extracted");
  assert.ok(
    holdoutCode.definition.includes("pattern=") &&
      holdoutCode.definition.includes("minLength=") &&
      holdoutCode.definition.includes("maxLength="),
    "Expected HoldoutCode facets to include pattern/minLength/maxLength",
  );

  const holdoutNumber = items.find((item) => item.term === "simpleType HoldoutNumber");
  assert.ok(holdoutNumber, "Expected HoldoutNumber simpleType to be extracted");
  assert.ok(
    holdoutNumber.definition.includes("minInclusive=") &&
      holdoutNumber.definition.includes("maxInclusive="),
    "Expected HoldoutNumber facets to include minInclusive/maxInclusive",
  );

  console.log("holdout tests passed");
}

run().catch((error) => {
  console.error("holdout tests failed", error);
  process.exit(1);
});
