import assert from "node:assert/strict";
import { createLinkedomHtmlEngine } from "../src/extractors/html-engine/linkedom.js";
import { assertHtmlEngineContract } from "../src/extractors/html-engine/contract.js";

async function testContractValidation() {
  const engine = createLinkedomHtmlEngine();
  assert.equal(assertHtmlEngineContract(engine), engine);

  assert.throws(
    () =>
      assertHtmlEngineContract({
        parse() {},
      }),
    /must implement method/,
  );
}

async function testLinkedomEngineSurface() {
  const engine = createLinkedomHtmlEngine();
  const dom = engine.parse({
    html: `<!doctype html>
<html>
  <head><title>Contract</title></head>
  <body>
    <section id="intro" class="normative">
      <h1>Intro</h1>
      <p data-k="v">Hello <strong>world</strong></p>
      <ul><li>One</li><li>Two</li></ul>
    </section>
  </body>
</html>`,
    url: "https://example.test/spec",
  });

  const section = engine.queryOne(dom.document, "section#intro");
  assert.ok(section, "section should be queryable");
  assert.deepEqual(engine.classNames(section), ["normative"]);
  assert.equal(engine.matches(section, "section.normative"), true);

  const listItems = engine.queryAll(section, "li");
  assert.equal(listItems.length, 2);
  assert.equal(engine.text(listItems[0]).trim(), "One");

  const nodes = engine.iterateElements(dom.document.body, {
    document: dom.document,
    NodeFilter: dom.NodeFilter,
    showElement: dom.NodeFilter?.SHOW_ELEMENT,
  });
  assert.ok(nodes.length >= 4, "element walker should traverse descendants");

  const paragraph = engine.queryOne(section, "p[data-k='v']");
  assert.equal(engine.text(paragraph).replace(/\s+/g, " ").trim(), "Hello world");
}

async function run() {
  await testContractValidation();
  await testLinkedomEngineSurface();
  console.log("html-engine contract tests passed");
}

run().catch((error) => {
  console.error("html-engine contract tests failed", error);
  process.exit(1);
});

