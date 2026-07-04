import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadMouseGestureCoreModule() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/mouseGestureCore.ts"),
    "utf8",
  );

  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });

  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("mouse gesture core resolves button policies", async () => {
  const core = await loadMouseGestureCoreModule();

  assert.equal(core.resolveMouseGesturePolicy(0)?.action, "search");
  assert.equal(core.resolveMouseGesturePolicy(1)?.action, "recentTab");
  assert.equal(core.resolveMouseGesturePolicy(2)?.action, "closeToRecent");
  assert.equal(core.resolveMouseGesturePolicy(3), null);
});

test("mouse gesture core preserves physical button mechanics separately from actions", async () => {
  const core = await loadMouseGestureCoreModule();

  assert.deepEqual(core.MOUSE_GESTURE_BUTTON_MECHANICS, [
    { button: 0, runPhase: "sessionStart", finishEvents: ["click"] },
    { button: 1, runPhase: "auxclick", finishEvents: ["auxclick"] },
    { button: 2, runPhase: "contextmenu", finishEvents: ["click", "auxclick", "contextmenu"] },
  ]);
});

test("mouse gesture core default policies match the legacy button table", async () => {
  const core = await loadMouseGestureCoreModule();

  assert.deepEqual(core.MOUSE_GESTURE_POLICIES, [
    { action: "search", button: 0, runPhase: "sessionStart", finishEvents: ["click"] },
    { action: "recentTab", button: 1, runPhase: "auxclick", finishEvents: ["auxclick"] },
    { action: "closeToRecent", button: 2, runPhase: "contextmenu", finishEvents: ["click", "auxclick", "contextmenu"] },
  ]);
});

test("mouse gesture core omits disabled click actions", async () => {
  const core = await loadMouseGestureCoreModule();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "none",
    middleClickAction: "recentTab",
    rightClickAction: "none",
  });

  assert.deepEqual(policies, [
    { action: "recentTab", button: 1, runPhase: "auxclick", finishEvents: ["auxclick"] },
  ]);
});

test("mouse gesture core keeps right-click contextmenu mechanics when remapped", async () => {
  const core = await loadMouseGestureCoreModule();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "search",
    middleClickAction: "recentTab",
    rightClickAction: "nativeNewTab",
  });
  const policy = core.resolveMouseGesturePolicy(2, policies);

  assert.deepEqual(policy, {
    action: "nativeNewTab",
    button: 2,
    runPhase: "contextmenu",
    finishEvents: ["click", "auxclick", "contextmenu"],
  });
});

test("mouse gesture core keeps middle-click auxclick mechanics when remapped to duplicate", async () => {
  const core = await loadMouseGestureCoreModule();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "openSettings",
    middleClickAction: "duplicateTab",
    rightClickAction: "closeToRecent",
  });

  assert.deepEqual(core.resolveMouseGesturePolicy(0, policies), {
    action: "openSettings",
    button: 0,
    runPhase: "sessionStart",
    finishEvents: ["click"],
  });
  assert.deepEqual(core.resolveMouseGesturePolicy(1, policies), {
    action: "duplicateTab",
    button: 1,
    runPhase: "auxclick",
    finishEvents: ["auxclick"],
  });
});

test("mouse gesture core claims middle click until auxclick", async () => {
  const core = await loadMouseGestureCoreModule();
  const policy = core.resolveMouseGesturePolicy(1);
  const session = core.createMouseGestureSession(policy, 1000);

  assert.equal(core.shouldRunMouseGestureSession(session, "mousedown"), false);
  assert.equal(core.shouldFinishMouseGestureSession(session, "mousedown"), false);
  assert.equal(core.shouldRunMouseGestureSession(session, "auxclick"), true);
  assert.equal(core.shouldFinishMouseGestureSession(session, "auxclick"), true);
});

test("mouse gesture core waits for contextmenu before right click close", async () => {
  const core = await loadMouseGestureCoreModule();
  const policy = core.resolveMouseGesturePolicy(2);
  const session = core.createMouseGestureSession(policy, 1000);

  assert.equal(core.shouldRunMouseGestureSession(session, "mousedown"), false);
  assert.equal(core.isMouseGestureEventForSession(session, { type: "contextmenu", button: 0 }), true);
  assert.equal(core.shouldRunMouseGestureSession(session, "contextmenu"), true);
  assert.equal(core.shouldFinishMouseGestureSession(session, "contextmenu"), true);
});

test("mouse gesture core expires stale sessions", async () => {
  const core = await loadMouseGestureCoreModule();
  const policy = core.resolveMouseGesturePolicy(0);
  const session = core.createMouseGestureSession(policy, 1000);

  assert.equal(core.isMouseGestureSessionExpired(session, 1899), false);
  assert.equal(core.isMouseGestureSessionExpired(session, 1901), true);
});
