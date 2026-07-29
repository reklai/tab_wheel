import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/tabDragCore.ts"),
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

test("horizontal drag emits one move per crossed 56px step", async () => {
  const core = await loadCore();
  let state = core.createTabDragState(0);

  let advanced = core.advanceTabDragState(state, 55);
  assert.deepEqual(advanced.directions, []);
  assert.equal(advanced.state.anchorX, 0);

  advanced = core.advanceTabDragState(advanced.state, 56);
  assert.deepEqual(advanced.directions, ["right"]);
  assert.equal(advanced.state.anchorX, 56);

  advanced = core.advanceTabDragState(advanced.state, 168);
  assert.deepEqual(advanced.directions, ["right", "right"]);
  assert.equal(advanced.state.anchorX, 168);
});

test("drag preserves sub-step remainder and reverses from its committed anchor", async () => {
  const core = await loadCore();
  const movedRight = core.advanceTabDragState(core.createTabDragState(100), 160);

  assert.deepEqual(movedRight.directions, ["right"]);
  assert.equal(movedRight.state.anchorX, 156);

  const movedLeft = core.advanceTabDragState(movedRight.state, 90);
  assert.deepEqual(movedLeft.directions, ["left"]);
  assert.equal(movedLeft.state.anchorX, 100);
});

test("a blocked direction stays silent until the pointer reverses a full step", async () => {
  const core = await loadCore();
  const atRightEdge = core.markTabDragBoundary(
    core.advanceTabDragState(core.createTabDragState(0), 56).state,
    "right",
  );

  const stillBlocked = core.advanceTabDragState(atRightEdge, 112);
  assert.deepEqual(stillBlocked.directions, []);
  assert.equal(stillBlocked.state.anchorX, 112);
  assert.equal(stillBlocked.state.blockedDirection, "right");

  const reversed = core.advanceTabDragState(stillBlocked.state, 56);
  assert.deepEqual(reversed.directions, ["left"]);
  assert.equal(reversed.state.blockedDirection, null);
});

test("target resolution never crosses pinned or tab-group boundaries", async () => {
  const core = await loadCore();
  const tabs = [
    { index: 0, pinned: true, groupId: -1 },
    { index: 1, pinned: false, groupId: -1 },
    { index: 2, pinned: false, groupId: -1 },
    { index: 3, pinned: false, groupId: 7 },
    { index: 4, pinned: false, groupId: 7 },
  ];

  assert.equal(core.resolveTabDragTargetIndex(tabs[0], tabs, "right"), null);
  assert.equal(core.resolveTabDragTargetIndex(tabs[1], tabs, "left"), null);
  assert.equal(core.resolveTabDragTargetIndex(tabs[1], tabs, "right"), 2);
  assert.equal(core.resolveTabDragTargetIndex(tabs[2], tabs, "right"), null);
  assert.equal(core.resolveTabDragTargetIndex(tabs[3], tabs, "left"), null);
  assert.equal(core.resolveTabDragTargetIndex(tabs[3], tabs, "right"), 4);
  assert.equal(core.resolveTabDragTargetIndex(tabs[4], tabs, "right"), null);
});

test("missing group ids normalize to the ungrouped lane", async () => {
  const core = await loadCore();
  const tabs = [
    { index: 2, pinned: false },
    { index: 3, pinned: false, groupId: -1 },
  ];

  assert.equal(core.resolveTabDragTargetIndex(tabs[0], tabs, "right"), 3);
  assert.equal(core.resolveTabDragTargetIndex(tabs[1], tabs, "left"), 2);
});

test("pending drag moves cancel opposing steps before they reach the browser", async () => {
  const core = await loadCore();

  assert.deepEqual(
    core.coalesceTabDragDirections(
      ["right", "right"],
      ["left", "left", "left"],
    ),
    ["left"],
  );
  assert.deepEqual(
    core.coalesceTabDragDirections(["left"], ["right", "right"]),
    ["right"],
  );
});

test("a boundary no-op removes only the queued step that compensated for it", async () => {
  const core = await loadCore();

  assert.deepEqual(
    core.reconcileTabDragBoundaryDirections(["left"], "right"),
    [],
  );
  assert.deepEqual(
    core.reconcileTabDragBoundaryDirections(["left", "left"], "right"),
    ["left"],
  );
  assert.deepEqual(
    core.reconcileTabDragBoundaryDirections(["right", "right"], "right"),
    [],
  );
});

test("a successful move clears a stale structural boundary latch", async () => {
  const core = await loadCore();
  const blocked = core.markTabDragBoundary(core.createTabDragState(56), "right");

  assert.equal(core.clearTabDragBoundary(blocked).blockedDirection, null);
});

test("pointer button masks detect a release that happened outside the page", async () => {
  const core = await loadCore();

  assert.equal(core.isTabDragButtonPressed(0, 1), true);
  assert.equal(core.isTabDragButtonPressed(1, 4), true);
  assert.equal(core.isTabDragButtonPressed(2, 2), true);
  assert.equal(core.isTabDragButtonPressed(0, 0), false);
  assert.equal(core.isTabDragButtonPressed(1, 1), false);
  assert.equal(core.isTabDragButtonPressed(2, 4), false);
});

test("a singleton tabs.move array is the successfully moved tab", async () => {
  const core = await loadCore();
  const movedTab = { id: 42, index: 3 };

  assert.deepEqual(core.resolveMovedTabResult(movedTab, 42), movedTab);
  assert.deepEqual(core.resolveMovedTabResult([movedTab], 42), movedTab);
  assert.equal(core.resolveMovedTabResult([], 42), null);
  assert.equal(core.resolveMovedTabResult([{ id: 99, index: 3 }], 42), null);
});

test("tabs.move arrays safely find the expected tab among other runtime values", async () => {
  const core = await loadCore();
  const movedTab = { id: 42, index: 3 };
  const otherTab = { id: 99, index: 2 };

  assert.deepEqual(core.resolveMovedTabResult([movedTab, otherTab], 42), movedTab);
  assert.deepEqual(core.resolveMovedTabResult([otherTab, movedTab, { id: 7 }], 42), movedTab);
  assert.deepEqual(core.resolveMovedTabResult([otherTab, { id: 7 }, movedTab], 42), movedTab);
  assert.deepEqual(core.resolveMovedTabResult([null, "invalid", movedTab], 42), movedTab);
  assert.equal(core.resolveMovedTabResult([null, "invalid", otherTab], 42), null);
});

test("matching-id malformed tabs are skipped without throwing", async () => {
  const core = await loadCore();
  const movedTab = { id: 42, index: 3 };
  const throwingTab = {
    get id() {
      throw new Error("malformed tab");
    },
    index: 1,
  };

  assert.equal(core.resolveMovedTabResult({ id: 42 }, 42), null);
  assert.deepEqual(core.resolveMovedTabResult([{ id: 42 }, movedTab], 42), movedTab);
  assert.deepEqual(core.resolveMovedTabResult([throwingTab, movedTab], 42), movedTab);
  assert.equal(core.resolveMovedTabResult([throwingTab], 42), null);
});
