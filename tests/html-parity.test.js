import assert from "node:assert/strict";
import { createLinkedomHtmlEngine } from "../src/extractors/html-engine/linkedom.js";
import { resolveHtmlEngine } from "../src/extractors/html-engine/index.js";
import { loadHtmlParityFixtures, runHtmlParityHarness } from "./helpers/html-parity-harness.js";

function stable(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stable(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

async function resolveParserStackEngineOrSkip() {
  try {
    return await resolveHtmlEngine({ engine: "parser-stack" });
  } catch (error) {
    if (String(error?.message || "").includes("Unable to load parser stack modules")) {
      console.log("html parity tests skipped:", error.message);
      return null;
    }
    throw error;
  }
}

async function testParityHarness() {
  const parserStackEngine = await resolveParserStackEngineOrSkip();
  if (!parserStackEngine) {
    return;
  }

  const fixtures = await loadHtmlParityFixtures();
  assert.ok(fixtures.length > 0, "expected at least one parity fixture");

  const linkedomEngine = createLinkedomHtmlEngine();
  const firstReport = runHtmlParityHarness({
    fixtures,
    linkedomEngine,
    parserStackEngine,
  });
  const secondReport = runHtmlParityHarness({
    fixtures,
    linkedomEngine,
    parserStackEngine,
  });

  assert.deepEqual(
    stable(secondReport),
    stable(firstReport),
    "parity report should be deterministic across repeated runs",
  );

  if (firstReport.summary.mismatchCount > 0) {
    console.error("html parity mismatches detected", JSON.stringify(firstReport, null, 2));
  }

  assert.equal(firstReport.summary.mismatchCount, 0, "parity harness found mismatches");
}

async function run() {
  await testParityHarness();
  console.log("html parity tests passed");
}

run().catch((error) => {
  console.error("html parity tests failed", error);
  process.exit(1);
});

