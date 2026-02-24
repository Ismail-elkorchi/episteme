import fs from "node:fs/promises";

export async function loadManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("Manifest must be an array.");
  }
  return data
    .filter((entry) => entry && typeof entry.url === "string")
    .map((entry) => ({
      url: entry.url,
      family: entry.family || null,
      authority: entry.authority || null,
      extractor: entry.extractor || null,
      output: entry.output || null,
      label: entry.label || null,
    }));
}
