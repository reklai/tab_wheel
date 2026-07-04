import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();

function readText(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

const OVERLAY_CSS_FILES = [
  "src/lib/ui/panels/help/help.css",
  "src/lib/ui/panels/searchLauncher/searchLauncher.css",
];

test("store and privacy docs include local-only/no-telemetry policy", () => {
  const store = readText("STORE.md");
  const privacy = readText("PRIVACY.md");
  assert.match(store, /No data leaves your browser/);
  assert.match(store, /Google fallback/);
  assert.match(privacy, /does not collect, transmit, or share/);
});

test("README states the fast feature-rich browser-native promise", () => {
  const readme = readText("README.md");
  assert.match(readme, /fast, feature-rich, and browser-native promise/);
  assert.match(readme, /reliability first/);
  assert.match(readme, /hot-path gestures do little work/);
  assert.match(readme, /without turning the page into a custom application shell/);
  assert.match(readme, /real browser lifecycle events such as fullscreen changes/);
});

test("core architecture keeps promise mechanisms explicit", () => {
  const appInit = readText("src/lib/appInit/appInit.ts");
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const panelHost = readText("src/lib/common/utils/panelHost.ts");

  assert.match(appInit, /MOUSE_GESTURE_POLICIES/);
  assert.match(appInit, /mouseGestureSession/);
  assert.match(appInit, /applyScrollRestoreAttempt/);
  assert.match(appInit, /cancelScrollRestore/);
  assert.match(domain, /runSerializedWindowTask/);
  assert.match(domain, /resolveMruCycleSessionTabs/);
  assert.match(domain, /windowTabsCacheByWindowId/);
  assert.match(domain, /scrollMemorySaveResolvers/);
  assert.match(domain, /scrollRestoreTokensByTabId/);
  assert.match(panelHost, /createPanelModalSession/);
  assert.match(panelHost, /fullscreenchange/);
});

test("package scripts expose engineering guardrail chain", () => {
  const packageJson = JSON.parse(readText("package.json"));
  assert.equal(packageJson.scripts.lint, "node esBuildConfig/lint.mjs");
  assert.equal(packageJson.scripts.test, "node --test test/*.test.mjs");
  assert.equal(packageJson.scripts["verify:store"], "node esBuildConfig/verifyStore.mjs");
  assert.equal(packageJson.scripts["release:package"], "node esBuildConfig/packageRelease.mjs");
  assert.match(packageJson.scripts.ci, /\bnpm run lint\b/);
  assert.match(packageJson.scripts.ci, /\bnpm run test\b/);
  assert.match(packageJson.scripts.ci, /\bnpm run verify:compat\b/);
  assert.match(packageJson.scripts.ci, /\bnpm run verify:store\b/);
});

test("overlay css includes anti-glitch container baseline", () => {
  for (const file of OVERLAY_CSS_FILES) {
    const css = readText(file);
    assert.match(css, /backface-visibility:\s*hidden/);
    assert.match(css, /will-change:\s*transform/);
  }
});
