import assert from "node:assert/strict";
import { resolveHtmlEngine } from "../src/extractors/html-engine/index.js";
import { assertHtmlEngineContract } from "../src/extractors/html-engine/contract.js";

async function resolveParserStackEngineOrSkip() {
  try {
    return await resolveHtmlEngine({ engine: "parser-stack" });
  } catch (error) {
    if (String(error?.message || "").includes("Unable to load parser stack modules")) {
      console.log("html-engine parser-stack tests skipped:", error.message);
      return null;
    }
    throw error;
  }
}

async function testParserStackEngineSurface() {
  const engine = await resolveParserStackEngineOrSkip();
  if (!engine) {
    return;
  }

  assert.equal(assertHtmlEngineContract(engine), engine);
  const dom = engine.parse({
    html: `<!doctype html>
<html>
  <head><title>Parser Stack</title></head>
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
  await testParserStackEngineSurface();
  console.log("html-engine parser-stack tests passed");
}

run().catch((error) => {
  console.error("html-engine parser-stack tests failed", error);
  process.exit(1);
});

