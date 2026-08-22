import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chunkAll } from "../src/pipeline/chunk.js";

async function testExtractedIdsCannotControlOutputPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "episteme-chunk-path-"));
  const inputDir = path.join(root, "input");
  const outDir = path.join(root, "out");
  const hostileFamily = "../escaped-family";

  try {
    await fs.mkdir(inputDir);
    await fs.writeFile(
      path.join(inputDir, "document.json"),
      JSON.stringify({
        url: "https://example.test/document",
        family: hostileFamily,
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
      }),
      "utf8",
    );

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

    await assert.rejects(fs.access(path.join(root, "escaped-family")));
    await assert.rejects(fs.access(path.join(outDir, "escaped.json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function run() {
  await testExtractedIdsCannotControlOutputPaths();
  console.log("chunk path safety tests passed");
}

run().catch((error) => {
  console.error("chunk path safety tests failed", error);
  process.exit(1);
});
