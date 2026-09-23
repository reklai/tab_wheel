import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("the Chrome manifest ships the V4 product", () => {
  const manifest = readJson("esBuildConfig/manifest.json");
  const pkg = readJson("package.json");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(pkg.version, "4.2.0");
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.name, "Scroll Wheel Tab Switcher");
  assert.equal(manifest.action.default_title, manifest.name);
  assert.equal(manifest.description, pkg.description);
});

test("the manifest contains only permissions needed by tab cycling, restore, and click actions", () => {
  const manifest = readJson("esBuildConfig/manifest.json");
  const retired = ["history", "bookmarks", "contextMenus", "search"];

  assert.deepEqual(manifest.permissions.sort(), ["scripting", "storage", "tabGroups", "tabs"].sort());
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  for (const permission of retired) {
    assert.equal(manifest.permissions.includes(permission), false);
  }
});

test("content scripts claim exact modifier-wheel gestures from document start", () => {
  const script = readJson("esBuildConfig/manifest.json").content_scripts[0];
  assert.equal(script.run_at, "document_start");
  assert.equal(script.all_frames, true);
  assert.equal(script.match_about_blank, true);
});

test("Chrome keeps activation support and no legacy surfaces", () => {
  const manifest = readJson("esBuildConfig/manifest.json");

  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabGroups"));
  assert.equal(manifest.commands, undefined);
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.browser_specific_settings, undefined);
});

test("Firefox is gone from the build, packaging, and scripts", () => {
  const pkg = readJson("package.json");
  const build = readFileSync(resolve(ROOT, "esBuildConfig/build.mjs"), "utf8");
  const packaging = readFileSync(resolve(ROOT, "esBuildConfig/packageRelease.mjs"), "utf8");

  assert.equal(existsSync(resolve(ROOT, "esBuildConfig/manifest_v2.json")), false);
  assert.equal(existsSync(resolve(ROOT, "esBuildConfig/manifest_v3.json")), false);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /firefox/i);
  assert.doesNotMatch(build, /firefox|--target/i);
  assert.doesNotMatch(packaging, /firefox|\.xpi/i);
});
