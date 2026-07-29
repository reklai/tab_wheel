import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));

test("compatibility verifier succeeds", () => {
  const result = spawnSync(process.execPath, [resolve(ROOT, "esBuildConfig/verifyCompat.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("manifests ship the same V4 product", () => {
  const firefox = readJson("esBuildConfig/manifest_v2.json");
  const chrome = readJson("esBuildConfig/manifest_v3.json");
  const pkg = readJson("package.json");

  assert.equal(pkg.version, "4.0.0");
  assert.equal(firefox.version, pkg.version);
  assert.equal(chrome.version, pkg.version);
  assert.equal(firefox.name, "Scroll Wheel Tab Switcher");
  assert.equal(chrome.name, firefox.name);
  assert.equal(chrome.description, firefox.description);
  assert.equal(chrome.action.default_title, firefox.browser_action.default_title);
});

test("manifests contain only permissions needed by tab cycling, restore, and click actions", () => {
  const firefox = readJson("esBuildConfig/manifest_v2.json");
  const chrome = readJson("esBuildConfig/manifest_v3.json");
  const retired = ["history", "bookmarks", "contextMenus", "search"];

  assert.deepEqual(firefox.permissions.sort(), ["<all_urls>", "storage", "tabs"].sort());
  assert.deepEqual(chrome.permissions.sort(), ["scripting", "storage", "tabGroups", "tabs"].sort());
  assert.deepEqual(chrome.host_permissions, ["<all_urls>"]);
  for (const permission of retired) {
    assert.equal(firefox.permissions.includes(permission), false);
    assert.equal(chrome.permissions.includes(permission), false);
  }
});

test("content scripts claim exact modifier-wheel gestures from document start", () => {
  for (const path of ["esBuildConfig/manifest_v2.json", "esBuildConfig/manifest_v3.json"]) {
    const script = readJson(path).content_scripts[0];
    assert.equal(script.run_at, "document_start");
    assert.equal(script.all_frames, true);
    assert.equal(script.match_about_blank, true);
  }
});

test("Firefox keeps AMO no-data metadata and Chrome keeps activation support", () => {
  const firefox = readJson("esBuildConfig/manifest_v2.json");
  const chrome = readJson("esBuildConfig/manifest_v3.json");

  assert.ok(firefox.browser_specific_settings.gecko.id);
  assert.ok(firefox.browser_specific_settings.gecko.data_collection_permissions.required.includes("none"));
  assert.ok(chrome.permissions.includes("scripting"));
  assert.ok(chrome.permissions.includes("tabGroups"));
  assert.equal(firefox.commands, undefined);
  assert.equal(chrome.commands, undefined);
  assert.equal(firefox.sidebar_action, undefined);
  assert.equal(chrome.side_panel, undefined);
});
