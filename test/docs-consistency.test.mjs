import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("contributor docs point to release, listing, and privacy sources", () => {
  const contributing = readText("CONTRIBUTING.md");
  for (const doc of ["RELEASE.md", "STORE.md", "PRIVACY.md"]) {
    assert.ok(contributing.includes(doc));
  }
});

test("public docs describe the same focused 3.0 product and defaults", () => {
  const combined = [
    readText("README.md"),
    readText("STORE.md"),
    readText("PRIVACY.md"),
    readText("RELEASE.md"),
  ].join("\n");

  assert.match(combined, /Alt\s*\/\s*Option \+ (?:mouse )?wheel/i);
  assert.match(combined, /page.position/i);
  assert.match(combined, /left.to.right/i);
  assert.match(combined, /recently used/i);
  assert.match(combined, /modifier \+ middle click/i);
  assert.match(combined, /Open settings/i);
  assert.match(combined, /Off/i);
  assert.match(combined, /3\.0\.0/);
  assert.match(readText("STORE.md"), /CURRENT DEFAULTS/);
  assert.match(readText("STORE.md"), /No data leaves your browser/);
});

test("public docs no longer market the retired adjacent features", () => {
  const combined = [
    readText("README.md"),
    readText("STORE.md"),
    readText("PRIVACY.md"),
  ].join("\n");

  assert.doesNotMatch(combined, /TabWheel Search now|CLICK ACTIONS:|Google fallback|history suggestions|general click remapping is available/i);
  assert.doesNotMatch(combined, /Alt \+ Left Click|Alt \+ Middle Click|Alt \+ Right Click/i);
  assert.doesNotMatch(combined, /page-scroll speed|viewport step cap|"Wheel List"|tag\/untag/i);
});
