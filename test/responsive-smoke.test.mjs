import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("popup keeps its complete control set in an internal scroll region", () => {
  const css = readText("src/entryPoints/toolbarPopup/toolbarPopup.css");
  assert.match(css, /html,\s*body\s*\{\s*width:\s*380px/);
  assert.match(css, /\.popup-shell\s*\{[\s\S]*height:\s*600px/);
  assert.match(css, /\.popup-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css, /body\s*\{[\s\S]*overflow:\s*hidden/);
});

test("settings and onboarding collapse cleanly on narrow screens", () => {
  const options = readText("src/entryPoints/optionsPage/optionsPage.css");
  const onboarding = readText("src/entryPoints/onboarding/onboarding.css");

  assert.match(options, /@media \(max-width:\s*620px\)/);
  assert.match(options, /\.setting-row,\s*\.range-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(onboarding, /@media \(max-width:\s*680px\)/);
  assert.match(onboarding, /\.update-columns,\s*\.click-system,\s*\.action-grid,\s*\.choice-list\.compact-choices,\s*\.mouse-intro-actions\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(onboarding, /\.setup-progress\s*\{\s*grid-template-columns:\s*repeat\(3,\s*1fr\)/);
});
