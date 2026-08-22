import assert from "node:assert/strict";
import test from "node:test";
import { loadFamilyPlugins, resolveFamily } from "../src/registry.js";

test("loads unique family plugins with a generic fallback", async () => {
  const plugins = await loadFamilyPlugins();
  const ids = plugins.map((plugin) => plugin.id);
  assert.equal(ids.length, 17);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("generic"));
  assert.ok(ids.includes("w3c"));
  assert.ok(ids.includes("whatwg"));
});

test("resolves explicit, detected, and generic families", async () => {
  const plugins = await loadFamilyPlugins();
  assert.equal(resolveFamily(plugins, "https://example.test", "rfc").id, "rfc");
  assert.equal(resolveFamily(plugins, "https://www.w3.org/TR/example").id, "w3c");
  assert.equal(resolveFamily(plugins, "https://example.test/document").id, "generic");
  assert.equal(resolveFamily(plugins, "https://example.test", "missing").id, "generic");
});
