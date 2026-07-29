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

test("public docs describe the same mouse-first product and defaults", () => {
  const combined = [
    readText("README.md"),
    readText("STORE.md"),
    readText("PRIVACY.md"),
    readText("RELEASE.md"),
  ].join("\n");

  assert.match(combined, /Alt\s*\/\s*Option \+ (?:mouse )?wheel/i);
  assert.match(combined, /page.position/i);
  assert.match(combined, /left.to.right/i);
  assert.match(combined, /Most recent tab/i);
  assert.match(combined, /Modifier \+ left click/i);
  assert.match(combined, /modifier \+ middle click/i);
  assert.match(combined, /modifier \+ right click/i);
  assert.match(combined, /Open settings/i);
  assert.match(combined, /Off/i);
  assert.match(combined, /Browser new tab/i);
  assert.match(combined, /Close current tab/i);
  assert.match(combined, /Drag current tab/i);
  assert.match(combined, /drag horizontally/i);
  assert.match(combined, /4\.0\.0/);
  assert.match(combined, /3\.0\.0/);
  assert.match(readText("STORE.md"), /CURRENT DEFAULTS/);
  assert.match(readText("STORE.md"), /No data is sent to TabWheel/);
  assert.doesNotMatch(
    combined,
    /Close current\s*→\s*recent|close-to-previous|close to the previous tab/i,
  );
});

test("public docs do not revive retired search or page-scroll modification", () => {
  const combined = [
    readText("README.md"),
    readText("STORE.md"),
    readText("PRIVACY.md"),
  ].join("\n");

  assert.doesNotMatch(combined, /Google fallback|history suggestions|Search API|search permission/i);
  assert.doesNotMatch(combined, /recently.used (?:mode|cycling)|MRU (?:mode|cycling)/i);
  assert.doesNotMatch(combined, /page-scroll speed|viewport step cap|"Wheel List"|tag\/untag/i);
});
