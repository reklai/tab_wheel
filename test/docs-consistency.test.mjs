import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readText(pathFromRoot) {
  return readFileSync(resolve(root, pathFromRoot), "utf8");
}

test("contributor docs reference release/store/privacy docs", () => {
  const contributing = readText("CONTRIBUTING.md");
  assert.ok(contributing.includes("RELEASE.md"));
  assert.ok(contributing.includes("STORE.md"));
  assert.ok(contributing.includes("PRIVACY.md"));
});

test("store and privacy docs match current TabWheel limits", () => {
  const store = readText("STORE.md");
  const privacy = readText("PRIVACY.md");

  assert.ok(store.includes("Firefox / Zen: Scroll Wheel Tab Switcher"));
  assert.ok(store.includes("Chrome: Scroll Wheel Tab Switcher"));
  assert.ok(store.includes("WHAT'S NEW IN 2.1.0"));
  assert.ok(store.includes("CURRENT DEFAULTS"));
  assert.ok(store.includes("TagWheel") === false);
  assert.ok(store.includes("Alt + Wheel"));
  assert.ok(store.includes("Hold Alt and scroll your mouse wheel to switch tabs"));
  assert.ok(store.includes("page-scroll speed"));
  assert.ok(store.includes("viewport step cap"));
  assert.ok(store.includes("Most Recently Used mode"));
  assert.ok(store.includes("Alt + Left Click"));
  assert.ok(store.includes("Browser Default"));
  assert.ok(store.includes("Alt + Middle Click"));
  assert.ok(store.includes("Alt + Right Click"));
  assert.ok(store.includes("Previous / Next"));
  assert.doesNotMatch(store, /Right Hold|Wheel List|tagged|tag\/untag/);
  assert.ok(privacy.includes("editable-field preference"));
  assert.ok(privacy.includes("page-scroll speed"));
  assert.ok(privacy.includes("viewport step cap"));
  assert.ok(privacy.includes("page URLs used only to validate scroll restore"));
  assert.ok(privacy.includes("tabWheelMruState"));
  assert.ok(privacy.includes("browser's current default search provider"));
  assert.ok(store.includes("browser's current default search provider"));
  assert.ok(privacy.includes("Google fallback"));
  assert.ok(store.includes("Google fallback"));
  assert.doesNotMatch(`${store}\n${privacy}`, /configurable search URL template|fallback search URL template/);
  assert.ok(privacy.includes("scripting"));
  assert.doesNotMatch(store, /Alt \+ T(?![a-z])/);
  assert.doesNotMatch(store, /Alt \+ M(?!iddle)/);
  assert.ok(privacy.includes("bounded to 300 entries"));
  assert.doesNotMatch(`${store}\n${privacy}`, /tab zoom|browser zoom/i);
  assert.equal(store.includes("sidePanel"), false);
  assert.equal(privacy.includes("sidePanel"), false);
});

test("docs no longer advertise removed legacy and tag features", () => {
  const combined = `${readText("README.md")}\n${readText("STORE.md")}\n${readText("PRIVACY.md")}`;
  assert.doesNotMatch(combined, /Tab Manager|Anchor Tags|keybindings|frecency|ScrollRail|Harpoon-Tabs|sessions?|Wheel List|tagged|tag\/untag/i);
});
