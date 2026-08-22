import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chunkAll } from "../src/pipeline/chunk.js";
import { buildIndex } from "../src/pipeline/index.js";
import { fingerprintJson, withFingerprint, writeJson } from "../src/utils.js";
import { extractionFixture } from "./helpers/extraction-fixture.js";

test("extracted IDs cannot control output paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-chunk-path-"));
  const inputDir = path.join(root, "input");
  const outDir = path.join(root, "out");
  const hostileFamily = "../escaped-family";

  try {
    await fs.mkdir(inputDir);
    const url = "https://example.test/document";
    const context = extractionFixture({
      url,
      content: "The payload must remain in the family directory.",
      contentType: "text/plain; charset=utf-8",
      extractor: "text",
      family: hostileFamily,
    });
    const document = {
        schemaVersion: "1",
        contentTrust: "untrusted-source",
        url,
        title: "Hostile identifiers",
        family: hostileFamily,
        authority: "informative",
        documentType: null,
        ...context,
        sections: [
          {
            id: "../../../hostile-section",
            heading: "Hostile identifiers",
            blocks: [
              {
                id: "../../../../escaped",
                type: "paragraph",
                text: "The payload must remain in the family directory.",
              },
            ],
          },
        ],
      };
    const docId = `document-${fingerprintJson(document)}`;
    const documentPath = path.join("documents", `${docId}.json`);
    const written = await writeJson(path.join(inputDir, documentPath), document);
    await writeJson(path.join(inputDir, "index.json"), withFingerprint({
      schemaVersion: "1",
      artifactType: "document-index",
      documents: [{
        docId,
        url,
        snapshotId: document.snapshotId,
        extractor: document.provenance.extractor,
        family: hostileFamily,
        path: documentPath,
        bytes: written.bytes,
        sha256: written.sha256,
      }],
    }));

    await chunkAll({ inputDir, outDir });

    const index = JSON.parse(await fs.readFile(path.join(outDir, "index.json"), "utf8"));
    assert.equal(index.chunks.length, 1);
    assert.equal(index.chunks[0].family, hostileFamily);

    const relativePath = index.chunks[0].path;
    assert.equal(relativePath.startsWith(`family-`), true);
    assert.equal(relativePath.includes(".."), false);

    const resolvedOutput = path.resolve(outDir, relativePath);
    const resolvedOutDir = `${path.resolve(outDir)}${path.sep}`;
    assert.equal(resolvedOutput.startsWith(resolvedOutDir), true);
    assert.equal(JSON.parse(await fs.readFile(resolvedOutput, "utf8")).text.includes("payload"), true);

    const hostileIndex = withFingerprint({
      ...index,
      chunks: [{ ...index.chunks[0], path: "../outside.json" }],
    });
    await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify(hostileIndex), "utf8");
    await assert.rejects(
      buildIndex({ chunksDir: outDir, outFile: path.join(outDir, "search-index.json") }),
      (error) => error.code === "INVALID_INPUT" && /escapes the chunk directory/u.test(error.message),
    );

    await assert.rejects(fs.access(path.join(root, "escaped-family")));
    await assert.rejects(fs.access(path.join(outDir, "escaped.json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
