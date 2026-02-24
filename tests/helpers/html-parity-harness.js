import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { extractHtmlDocument } from "../../src/extractors/html.js";

const FIXTURES_DIR = new URL("../fixtures/html-parity/", import.meta.url);

const CLASSIFICATION = Object.freeze({
  ADAPTER_BUG: "adapter bug in Episteme",
  PARSER_GAP: "contract gap in html-parser",
  SELECTOR_GAP: "selector gap in css-parser",
  INTENTIONAL_DELTA: "intentional behavior delta",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (isPlainObject(value)) {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      sorted[key] = normalizeValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function normalizeExtractedDocument(documentData) {
  const normalized = normalizeValue(JSON.parse(JSON.stringify(documentData)));
  delete normalized.extractedAt;
  return normalized;
}

function hashStable(value) {
  return createHash("sha256").update(JSON.stringify(normalizeValue(value))).digest("hex").slice(0, 16);
}

function classifyMismatch(fixture, mismatchPath) {
  const intentional = Array.isArray(fixture.intentionalDeltas) ? fixture.intentionalDeltas : [];
  if (intentional.some((pattern) => mismatchPath.includes(pattern))) {
    return CLASSIFICATION.INTENTIONAL_DELTA;
  }
  if (
    mismatchPath.includes(".links")
    || mismatchPath.includes(".source.path")
    || mismatchPath.includes(".id")
    || mismatchPath.includes(".fragment")
  ) {
    return CLASSIFICATION.SELECTOR_GAP;
  }
  if (mismatchPath.includes(".title") || mismatchPath.includes(".heading") || mismatchPath.includes(".text")) {
    return CLASSIFICATION.PARSER_GAP;
  }
  return CLASSIFICATION.ADAPTER_BUG;
}

function compareValues(left, right, path, mismatches) {
  if (Object.is(left, right)) {
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) {
      const nextPath = `${path}[${index}]`;
      const leftHas = index < left.length;
      const rightHas = index < right.length;
      if (!leftHas) {
        mismatches.push({
          path: nextPath,
          kind: "missing-in-linkedom",
          linkedomValue: undefined,
          parserStackValue: right[index],
        });
        continue;
      }
      if (!rightHas) {
        mismatches.push({
          path: nextPath,
          kind: "missing-in-parser-stack",
          linkedomValue: left[index],
          parserStackValue: undefined,
        });
        continue;
      }
      compareValues(left[index], right[index], nextPath, mismatches);
    }
    return;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
    for (const key of keys) {
      const nextPath = `${path}.${key}`;
      const leftHas = Object.prototype.hasOwnProperty.call(left, key);
      const rightHas = Object.prototype.hasOwnProperty.call(right, key);
      if (!leftHas) {
        mismatches.push({
          path: nextPath,
          kind: "missing-in-linkedom",
          linkedomValue: undefined,
          parserStackValue: right[key],
        });
        continue;
      }
      if (!rightHas) {
        mismatches.push({
          path: nextPath,
          kind: "missing-in-parser-stack",
          linkedomValue: left[key],
          parserStackValue: undefined,
        });
        continue;
      }
      compareValues(left[key], right[key], nextPath, mismatches);
    }
    return;
  }

  mismatches.push({
    path,
    kind: "value-mismatch",
    linkedomValue: left,
    parserStackValue: right,
  });
}

function buildMismatchRecords(fixture, linkedomDoc, parserStackDoc) {
  const mismatchDetails = [];
  compareValues(linkedomDoc, parserStackDoc, "$", mismatchDetails);
  return mismatchDetails.map((entry) => {
    const id = hashStable({
      fixtureId: fixture.id,
      path: entry.path,
      kind: entry.kind,
      linkedomValue: entry.linkedomValue,
      parserStackValue: entry.parserStackValue,
    });
    return {
      id,
      fixtureId: fixture.id,
      path: entry.path,
      kind: entry.kind,
      classification: classifyMismatch(fixture, entry.path),
      linkedomValue: entry.linkedomValue,
      parserStackValue: entry.parserStackValue,
    };
  });
}

export async function loadHtmlParityFixtures() {
  const names = await fs.readdir(FIXTURES_DIR);
  const fixtureNames = names.filter((name) => name.endsWith(".json")).sort();
  const fixtures = [];

  for (const name of fixtureNames) {
    const fixtureUrl = new URL(name, FIXTURES_DIR);
    const raw = await fs.readFile(fixtureUrl, "utf8");
    const fixture = JSON.parse(raw);
    fixtures.push(fixture);
  }

  return fixtures;
}

export function runHtmlParityHarness({ fixtures, linkedomEngine, parserStackEngine }) {
  const fixtureSummaries = [];
  const mismatches = [];

  for (const fixture of fixtures) {
    const linkedomDom = linkedomEngine.parse({ html: fixture.html, url: fixture.url });
    const parserStackDom = parserStackEngine.parse({ html: fixture.html, url: fixture.url });

    const linkedomDocument = normalizeExtractedDocument(
      extractHtmlDocument({
        rules: fixture.rules || {},
        url: fixture.url,
        family: fixture.family || "generic",
        authority: fixture.authority || "informative",
        snapshotId: fixture.snapshotId || `fixture-${fixture.id}`,
        source: fixture.source || { fixtureId: fixture.id },
        documentType: fixture.documentType || null,
        dom: linkedomDom,
        htmlEngine: linkedomEngine,
      }),
    );

    const parserStackDocument = normalizeExtractedDocument(
      extractHtmlDocument({
        rules: fixture.rules || {},
        url: fixture.url,
        family: fixture.family || "generic",
        authority: fixture.authority || "informative",
        snapshotId: fixture.snapshotId || `fixture-${fixture.id}`,
        source: fixture.source || { fixtureId: fixture.id },
        documentType: fixture.documentType || null,
        dom: parserStackDom,
        htmlEngine: parserStackEngine,
      }),
    );

    const fixtureMismatches = buildMismatchRecords(fixture, linkedomDocument, parserStackDocument);
    fixtureSummaries.push({
      fixtureId: fixture.id,
      mismatchCount: fixtureMismatches.length,
    });
    mismatches.push(...fixtureMismatches);
  }

  return {
    summary: {
      fixturesChecked: fixtures.length,
      mismatchCount: mismatches.length,
      mismatchingFixtures: fixtureSummaries.filter((entry) => entry.mismatchCount > 0).length,
    },
    fixtures: fixtureSummaries,
    mismatches,
  };
}

