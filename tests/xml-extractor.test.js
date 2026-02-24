import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractXmlDocument } from "../src/extractors/xml.js";
import { assertSchema } from "./helpers/schema-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XSD_FIXTURES_DIR = path.join(__dirname, "fixtures", "xsd");
const FIXTURE_BY_URL = new Map([
  ["https://www.loc.gov/standards/premis/v3/premis-v3-0.xsd", "premis-v3-0.xsd"],
  ["https://www.w3.org/2001/xml.xsd", "xml.xsd"],
]);

async function loadFixtureText(url) {
  const fileName = FIXTURE_BY_URL.get(url);
  assert.ok(fileName, `Missing XSD fixture mapping for ${url}`);
  return await fs.readFile(path.join(XSD_FIXTURES_DIR, fileName), "utf8");
}

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

function findDefinition(items, predicate) {
  return items.find((item) => predicate(item.term || "", item.definition || ""));
}

async function testPremisFacets() {
  const xmlText = await loadFixtureText(
    "https://www.loc.gov/standards/premis/v3/premis-v3-0.xsd",
  );
  const doc = extractXmlDocument({
    text: xmlText,
    url: "https://www.loc.gov/standards/premis/v3/premis-v3-0.xsd",
    family: "premis",
    authority: "normative",
    documentType: "xsd",
  });
  await assertSchema(doc, "premis-xsd");

  const items = collectDefinitionItems(doc);
  const facetItem = findDefinition(items, (term, definition) =>
    term.startsWith("simpleType ") &&
    definition.includes("facets=[") &&
    definition.includes("enumeration="),
  );

  assert.ok(
    facetItem,
    "Expected PREMIS XSD to yield at least one simpleType with enumeration facets",
  );
}

async function testXmlNamespaceFacets() {
  const xmlText = await loadFixtureText("https://www.w3.org/2001/xml.xsd");
  const doc = extractXmlDocument({
    text: xmlText,
    url: "https://www.w3.org/2001/xml.xsd",
    family: "w3c",
    authority: "normative",
    documentType: "xsd",
  });
  await assertSchema(doc, "xml-xsd");

  const items = collectDefinitionItems(doc);
  const facetItem = findDefinition(items, (term, definition) =>
    term.startsWith("simpleType ") &&
    definition.includes("facets=[") &&
    definition.includes("enumeration="),
  );

  assert.ok(
    facetItem,
    "Expected xml.xsd to yield at least one simpleType with enumeration facets",
  );
}

async function testSyntheticAssertions() {
  const synthetic = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning"
  vc:minVersion="1.1">
  <xs:complexType name="RangeType">
    <xs:sequence>
      <xs:element name="min" type="xs:int"/>
      <xs:element name="max" type="xs:int"/>
    </xs:sequence>
    <xs:assert test="xs:int(min) le xs:int(max)"/>
  </xs:complexType>
  <xs:simpleType name="CodeType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{3}"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

  const doc = extractXmlDocument({
    text: synthetic,
    url: "https://example.test/synthetic.xsd",
    family: "synthetic",
    authority: "informative",
    documentType: "xsd",
  });
  await assertSchema(doc, "synthetic-xsd");

  const items = collectDefinitionItems(doc);
  const assertionItem = findDefinition(items, (term, definition) =>
    term === "complexType RangeType" &&
    definition.includes("assertions=[") &&
    definition.includes("test="),
  );

  assert.ok(
    assertionItem,
    "Expected synthetic XSD to yield an assertion summary on complexType RangeType",
  );
}

async function run() {
  await testPremisFacets();
  await testXmlNamespaceFacets();
  await testSyntheticAssertions();
  console.log("xml-extractor tests passed");
}

run().catch((error) => {
  console.error("xml-extractor tests failed", error);
  process.exit(1);
});
