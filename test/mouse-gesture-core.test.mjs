import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
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

test("default policies map all three physical buttons", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies(
    core.DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  );

  assert.deepEqual(policies, [
    { action: "nativeNewTab", button: 0, interaction: "click", runPhase: "click" },
    { action: "dragCurrentTab", button: 1, interaction: "drag" },
    { action: "closeToRecent", button: 2, interaction: "click", runPhase: "contextmenu" },
  ]);
});

test("Off omits only that physical button policy", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "none",
    middleClickAction: "duplicateTab",
    rightClickAction: "none",
  });

  assert.deepEqual(policies, [
    { action: "duplicateTab", button: 1, interaction: "click", runPhase: "auxclick" },
  ]);
  assert.equal(core.resolveMouseGesturePolicy(0, policies), null);
  assert.equal(core.resolveMouseGesturePolicy(2, policies), null);
});

test("Drag current tab is a drag policy without a click completion phase", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "dragCurrentTab",
    middleClickAction: "none",
    rightClickAction: "none",
  });

  assert.deepEqual(policies, [
    { action: "dragCurrentTab", button: 0, interaction: "drag" },
  ]);
});

test("sessions start only on press events and run once on completion", async () => {
  const core = await loadCore();
  // Click-style middle mapping: default middle is drag, so pin a click action here.
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "none",
    middleClickAction: "recentTab",
    rightClickAction: "none",
  });
  const policy = core.resolveMouseGesturePolicy(1, policies);
  const session = core.createMouseGestureSession(policy, 100);

  assert.equal(core.isMouseGestureSessionStartEvent({ type: "pointerdown", button: 1 }), true);
  assert.equal(core.isMouseGestureSessionStartEvent({ type: "mousedown", button: 1 }), true);
  assert.equal(core.isMouseGestureSessionStartEvent({ type: "auxclick", button: 1 }), false);
  assert.equal(core.shouldRunMouseGestureSession(session, "mousedown"), false);
  assert.equal(core.shouldRunMouseGestureSession(session, "auxclick"), true);
  session.hasRun = true;
  assert.equal(core.shouldRunMouseGestureSession(session, "auxclick"), false);
  assert.equal(core.shouldFinishMouseGestureSession(session, "auxclick"), true);
});

test("right-click sessions accept compatibility contextmenu button values", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies(
    core.DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  );
  const session = core.createMouseGestureSession(
    core.resolveMouseGesturePolicy(2, policies),
    100,
  );

  assert.equal(
    core.isMouseGestureEventForSession(session, { type: "contextmenu", button: 0 }),
    true,
  );
  assert.equal(core.shouldRunMouseGestureSession(session, "contextmenu"), true);
});

test("gesture claims expire", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies(
    core.DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  );
  const session = core.createMouseGestureSession(
    core.resolveMouseGesturePolicy(0, policies),
    100,
  );

  assert.equal(core.isMouseGestureSessionExpired(session, 1000), false);
  assert.equal(core.isMouseGestureSessionExpired(session, 1001), true);
});

test("mute, back, and forward are plain click policies on every button", async () => {
  const core = await loadCore();
  const policies = core.buildMouseGesturePolicies({
    leftClickAction: "goBack",
    middleClickAction: "muteTab",
    rightClickAction: "goForward",
  });

  assert.deepEqual(policies, [
    { action: "goBack", button: 0, interaction: "click", runPhase: "click" },
    { action: "muteTab", button: 1, interaction: "click", runPhase: "auxclick" },
    { action: "goForward", button: 2, interaction: "click", runPhase: "contextmenu" },
  ]);
});

test("the click action list offers the new actions before Off", async () => {
  const core = await loadCore();
  const actions = core.TABWHEEL_CLICK_ACTIONS;

  for (const action of ["muteTab", "goBack", "goForward"]) {
    assert.ok(actions.includes(action), `${action} is offered`);
    assert.ok(actions.indexOf(action) < actions.indexOf("none"), `${action} is listed before Off`);
  }
  assert.equal(actions.at(-1), "none");
});
