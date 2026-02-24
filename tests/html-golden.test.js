import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveHtmlEngine } from "../src/extractors/html-engine/index.js";
import { extractHtmlDocument } from "../src/extractors/html.js";

// Fixture conventions:
// - one directory per case id under tests/fixtures/html-golden
// - each fixture directory contains input.html, rules.json, expected.json
// - ids remain stable and lexically sortable for deterministic ordering
const FIXTURES_ROOT = path.join("tests", "fixtures", "html-golden");

function normalizeExtractedDocument(documentData) {
  const clone = JSON.parse(JSON.stringify(documentData));
  delete clone.extractedAt;
  return clone;
}

async function listFixtureIds() {
  const entries = await fs.readdir(FIXTURES_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function loadFixture(id) {
  const fixtureDir = path.join(FIXTURES_ROOT, id);
  const html = await fs.readFile(path.join(fixtureDir, "input.html"), "utf8");
  const rules = JSON.parse(await fs.readFile(path.join(fixtureDir, "rules.json"), "utf8"));
  const expected = JSON.parse(await fs.readFile(path.join(fixtureDir, "expected.json"), "utf8"));
  return { id, html, rules, expected };
}

function extractFixture({ fixture, engine }) {
  const url = `https://example.test/${fixture.id}`;
  const dom = engine.parse({ html: fixture.html, url });
  const documentData = extractHtmlDocument({
    rules: fixture.rules,
    url,
    family: "generic",
    authority: "informative",
    snapshotId: `fixture-${fixture.id}`,
    source: { fixtureId: fixture.id },
    documentType: null,
    dom,
    htmlEngine: engine,
  });
  return normalizeExtractedDocument(documentData);
}

async function testGoldenFixtures() {
  const fixtureIds = await listFixtureIds();
  assert.ok(fixtureIds.length > 0, "expected at least one golden fixture");
  const engine = await resolveHtmlEngine();

  for (const fixtureId of fixtureIds) {
    const fixture = await loadFixture(fixtureId);
    const runA = extractFixture({ fixture, engine });
    const runB = extractFixture({ fixture, engine });

    assert.deepEqual(runB, runA, `fixture "${fixtureId}" is non-deterministic across repeated runs`);
    assert.deepEqual(runA, fixture.expected, `fixture "${fixtureId}" output mismatch`);
  }
}

async function run() {
  await testGoldenFixtures();
  console.log("html golden fixture tests passed");
}

run().catch((error) => {
  console.error("html golden fixture tests failed", error);
  process.exit(1);
});
