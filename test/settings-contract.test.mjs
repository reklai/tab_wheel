import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();

async function loadSettingsContract() {
  const result = await build({
    entryPoints: [resolve(ROOT, "src/lib/common/contracts/tabWheel.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [{
      name: "browser-polyfill-stub",
      setup(builder) {
        builder.onResolve(
          { filter: /^webextension-polyfill$/ },
          () => ({ path: "browser-polyfill", namespace: "test" }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "test" },
          () => ({ contents: "export default {};", loader: "js" }),
        );
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("the close action uses the canonical user-facing name", async () => {
  const contract = await loadSettingsContract();

  assert.equal(contract.formatTabWheelClickAction("closeToRecent"), "Close current tab");
});

test("mute, back, and forward use their canonical user-facing names", async () => {
  const contract = await loadSettingsContract();

  assert.equal(contract.formatTabWheelClickAction("muteTab"), "Mute / unmute tab");
  assert.equal(contract.formatTabWheelClickAction("goBack"), "Go back");
  assert.equal(contract.formatTabWheelClickAction("goForward"), "Go forward");
});

test("saved mute, back, and forward mappings survive normalization", async () => {
  const contract = await loadSettingsContract();

  const settings = contract.normalizeTabWheelSettings({
    leftClickAction: "goBack",
    middleClickAction: "muteTab",
    rightClickAction: "goForward",
  });

  assert.equal(settings.leftClickAction, "goBack");
  assert.equal(settings.middleClickAction, "muteTab");
  assert.equal(settings.rightClickAction, "goForward");
});

test("the mouse-action list is ordered alphabetically by its visible label", async () => {
  const contract = await loadSettingsContract();
  const labels = contract.TABWHEEL_CLICK_ACTIONS.map(contract.formatTabWheelClickAction);
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(labels, sorted, `dropdown order should be alphabetical by label, got ${JSON.stringify(labels)}`);
});
