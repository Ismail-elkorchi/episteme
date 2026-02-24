import assert from "node:assert/strict";
import { extractHtmlDocument } from "../src/extractors/html.js";
import { resolveHtmlEngine } from "../src/extractors/html-engine/index.js";
import { assertSchema } from "./helpers/schema-validator.js";

async function buildDom(html, url) {
  const engine = await resolveHtmlEngine();
  return engine.parse({ html, url });
}

async function testHtmlExtraction() {
  const html = `<!doctype html>
<html>
<head><title>Test Doc</title></head>
<body>
  <h1 id="intro">Introduction</h1>
  <p>First paragraph.</p>
  <ul>
    <li>Item one</li>
    <li>Item two</li>
  </ul>
</body>
</html>`;

  const dom = await buildDom(html, "https://example.test/doc");
  const doc = extractHtmlDocument({
    rules: {
      rootSelector: "body",
      useHeadings: true,
      pruneSelectors: [],
    },
    url: "https://example.test/doc",
    family: "generic",
    authority: "informative",
    dom,
  });

  await assertSchema(doc, "html-doc");
  assert.equal(doc.title, "Test Doc");
  assert.ok(doc.sections.length >= 1, "Expected at least one section");
  const first = doc.sections[0];
  assert.equal(first.heading, "Introduction");
  const textBlocks = first.blocks.filter((block) => block.type === "paragraph");
  assert.ok(textBlocks.some((block) => block.text.includes("First paragraph")));
}

async function run() {
  await testHtmlExtraction();
  console.log("html-extractor tests passed");
}

run().catch((error) => {
  console.error("html-extractor tests failed", error);
  process.exit(1);
});
