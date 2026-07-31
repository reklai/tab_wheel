import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const readText = (path) => readFileSync(resolve(root, path), "utf8");

test("verifyStore script succeeds", () => {
  const result = spawnSync(process.execPath, [resolve(root, "esBuildConfig/verifyStore.mjs")], {
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `verifyStore failed:\nstdout:\n${result.stdout || "(empty)"}\nstderr:\n${result.stderr || "(empty)"}`,
  );
});

test("store and package metadata use the approved mouse-first summary", () => {
  const expected =
    "Switch tabs with Alt + mouse wheel anywhere on the page. Fast, private, mouse-first tab control.";
  const manifestV2 = JSON.parse(readText("esBuildConfig/manifest_v2.json"));
  const manifestV3 = JSON.parse(readText("esBuildConfig/manifest_v3.json"));
  const packageJson = JSON.parse(readText("package.json"));
  const store = readText("STORE.md");
  const summary = store
    .match(/## Summary \(short[^\n]*\)\s+([\s\S]*?)\n## /)?.[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  assert.equal(expected.length, 96);
  assert.equal(manifestV2.description, expected);
  assert.equal(manifestV3.description, expected);
  assert.equal(packageJson.description, expected);
  assert.equal(summary, expected);
  assert.match(
    store,
    /Modifier \+ right click uses Close current tab and returns to the most recent tab\./,
  );
  assert.match(store, /Fresh installs and updates from pre-V4 releases/);
});

test("store release copy identifies Drag current tab as the remappable middle-click default", () => {
  const store = readText("STORE.md");
  const whatsNew = store.match(/WHAT'S NEW IN 4\.0\.2\s+([^\n]+)/)?.[1] || "";

  assert.match(
    whatsNew,
    /Drag current tab is the default middle-click mapping and remains remappable\./,
  );
  assert.doesNotMatch(whatsNew, /Drag current tab is an optional mapping/);
});

test("source releases preflight before output and exclude previous release artifacts", () => {
  const packaging = readText("esBuildConfig/packageRelease.mjs");
  const main = packaging.match(/function main\(\) \{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(
    packaging,
    /run\("git",\s*\[\s*"archive",\s*"--format=zip",\s*`--output=\$\{archivePath\}`,\s*"HEAD",\s*"--",\s*"\.",\s*":\(exclude\)release",?\s*\]\)/,
  );
  assert.doesNotMatch(packaging, /function zipSource\(/);
  assert.ok(
    main.indexOf("ensureCleanSourceTree();") < main.indexOf("mkdirSync(releaseDir"),
    "clean-tree preflight must run before release output is created",
  );
  assert.ok(
    main.indexOf("ensureCleanSourceTree();") < main.indexOf("for (const artifactPath"),
    "clean-tree preflight must run before release output is refreshed",
  );
});

test("release packaging preserves historical artifacts while refreshing V4 outputs", () => {
  const packaging = readText("esBuildConfig/packageRelease.mjs");
  const gitignore = readText(".gitignore");

  assert.doesNotMatch(packaging, /rmSync\(releaseDir,\s*\{\s*recursive:\s*true/);
  assert.match(packaging, /for \(const artifactPath of releaseArtifacts\)/);
  assert.match(packaging, /rmSync\(artifactPath,\s*\{\s*force:\s*true\s*\}\)/);
  assert.match(gitignore, /^\/release\/tabwheel-chrome-v\*\.zip$/m);
  assert.match(gitignore, /^\/release\/tabwheel-firefox-v\*\.xpi$/m);
  assert.match(gitignore, /^\/release\/tabwheel-source-v\*\.zip$/m);
});

test("store assets use V4 copy and current mouse-action defaults", () => {
  const assetReadme = readText("store-assets/README.md");
  const assetCopy = readdirSync(resolve(root, "store-assets/source"))
    .filter((name) => name.endsWith(".svg"))
    .map((name) => readText(`store-assets/source/${name}`))
    .join("\n");
  const submittedCopy = `${assetReadme}\n${assetCopy}`;
  const rejectedPhrase = new RegExp(
    ["without", "chasing", "the", "tab", "bar"].join("\\s+"),
    "i",
  );

  assert.match(assetReadme, /^# TabWheel 4\.0 store assets/m);
  assert.doesNotMatch(submittedCopy, rejectedPhrase);
  assert.match(assetCopy, /Browser new tab/);
  assert.match(assetCopy, /Drag current tab/);
  assert.match(assetCopy, /Close current tab/);
  // Middle-click default is Drag current tab — store art must not still sell Most recent tab as the default control label.
  assert.doesNotMatch(assetCopy, /Most recent tab ▾/);
  assert.doesNotMatch(
    assetCopy,
    /Middle click[\s\S]{0,120}Most recent tab/,
  );
});

test("store badge copy is limited to URLs TabWheel can recognize as restricted", () => {
  const readme = readText("README.md");
  const store = readText("STORE.md");

  assert.match(store, /recognized browser-restricted URLs/i);
  assert.match(readme, /recognized browser-restricted URLs/i);
  assert.doesNotMatch(store, /badge when a page is off-limits/i);
});
