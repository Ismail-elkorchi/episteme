import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveHtmlEngine } from "../src/extractors/html-engine/index.js";
import { extractHtmlDocument } from "../src/extractors/html.js";
import { assertSchema } from "./helpers/schema-validator.js";
import { extractionFixture } from "./helpers/extraction-fixture.js";

// Fixture conventions:
// - one directory per case id under tests/fixtures/html-golden
// - each fixture directory contains input.html, rules.json, expected.json
// - ids remain stable and lexically sortable for deterministic ordering
const FIXTURES_ROOT = path.join("tests", "fixtures", "html-golden");

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
    documentType: null,
    ...extractionFixture({
      url,
      content: fixture.html,
      contentType: "text/html; charset=utf-8",
      extractor: "html",
      rules: fixture.rules,
    }),
    dom,
  });
  return documentData;
}

test("matches deterministic HTML golden fixtures", async () => {
  const fixtureIds = await listFixtureIds();
  assert.ok(fixtureIds.length > 0, "expected at least one golden fixture");
  const engine = await resolveHtmlEngine();

  for (const fixtureId of fixtureIds) {
    const fixture = await loadFixture(fixtureId);
    const extractedA = extractFixture({ fixture, engine });
    const extractedB = extractFixture({ fixture, engine });
    await assertSchema(extractedA, `html-golden-${fixtureId}`);
    assert.deepEqual(extractedB, extractedA, `fixture "${fixtureId}" is non-deterministic across repeated runs`);
    assert.deepEqual(extractedA, fixture.expected, `fixture "${fixtureId}" output mismatch`);
  }
});
