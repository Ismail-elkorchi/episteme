import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAMILY_DIR = new URL("./families/", import.meta.url);

export async function loadFamilyPlugins() {
  const dirPath = fileURLToPath(FAMILY_DIR);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".js")) {
      continue;
    }
    const moduleUrl = pathToFileURL(path.join(dirPath, entry.name));
    const mod = await import(moduleUrl.href);
    const plugin = mod.default || mod.plugin || mod;
    if (plugin?.id) {
      plugins.push(plugin);
    }
  }
  const hasGeneric = plugins.some((plugin) => plugin.id === "generic");
  if (!hasGeneric) {
    plugins.push({
      id: "generic",
      label: "Generic",
      authority: "informative",
      documentType: null,
      match() {
        return true;
      },
      contentTypes: ["text/html"],
      extractor: "html",
      rules: {
        rootSelector: "main, body",
        sectionSelector: "section",
        useHeadings: true,
        pruneSelectors: ["nav", "header", "footer", "#toc", ".toc"],
      },
    });
  }
  return plugins;
}

export function resolveFamily(plugins, urlString, explicitFamily) {
  if (explicitFamily) {
    const match = plugins.find((plugin) => plugin.id === explicitFamily);
    if (match) {
      return match;
    }
  }
  const url = new URL(urlString);
  for (const plugin of plugins) {
    if (plugin.id === "generic") {
      continue;
    }
    if (plugin.match?.(url)) {
      return plugin;
    }
  }
  return plugins.find((plugin) => plugin.id === "generic");
}
