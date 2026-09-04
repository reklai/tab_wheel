import test from "node:test";
import assert from "node:assert/strict";
import { createGestureWorld } from "./helpers/gestureHarness.mjs";

// The one remaining allowed mouse action beyond the click set: Drag current
// tab. It is a drag interaction, not a click, so it runs through a different
// path (pointerdown claims, pointermove moves, release ends). Exercised on
// every button against the real content-script pipeline.

const BASE = {
  gestureModifier: "alt",
  gestureWithShift: false,
  leftClickAction: "none",
  middleClickAction: "none",
  rightClickAction: "none",
};

const BUTTONS = [
  { name: "left", button: 0, key: "leftClickAction" },
  { name: "middle", button: 1, key: "middleClickAction" },
  { name: "right", button: 2, key: "rightClickAction" },
];

for (const { name, button, key } of BUTTONS) {
  test(`${name} drag begins, moves, and ends, leaking no event to the page`, async () => {
    const world = await createGestureWorld({ ...BASE, [key]: "dragCurrentTab" });
    try {
      const { actions, leaked } = await world.drag(button, { slots: 2 });
      assert.equal(actions[0], "TABWHEEL_BEGIN_TAB_DRAG", "drag must open with begin");
      assert.equal(actions.at(-1), "TABWHEEL_END_TAB_DRAG", "drag must close with end");
      assert.ok(
        actions.includes("TABWHEEL_MOVE_CURRENT_TAB"),
        `a drag across a slot boundary must move the tab, got ${JSON.stringify(actions)}`,
      );
      assert.deepEqual(leaked, [], "every drag event must be suppressed");
    } finally {
      world.cleanup();
    }
  });
}

test("a drag with no movement still opens and closes cleanly without moving the tab", async () => {
  const world = await createGestureWorld({ ...BASE, middleClickAction: "dragCurrentTab" });
  try {
    const { actions, leaked } = await world.drag(1, { slots: 0 });
    assert.deepEqual(
      actions.filter((type) => type !== "TABWHEEL_MOVE_CURRENT_TAB"),
      ["TABWHEEL_BEGIN_TAB_DRAG", "TABWHEEL_END_TAB_DRAG"],
    );
    assert.ok(!actions.includes("TABWHEEL_MOVE_CURRENT_TAB"), "a still press must not move the tab");
    assert.deepEqual(leaked, []);
  } finally {
    world.cleanup();
  }
});

import { flushAsyncWork } from "./helpers/gestureHarness.mjs";

test("a fast out-and-back drag settles at the final pointer without replaying the excursion", async () => {
  const world = await createGestureWorld({ ...BASE, middleClickAction: "dragCurrentTab" });
  try {
    const target = new world.MockEditable("div");
    world.dispatch("pointerdown", { button: 1, alt: true, buttons: 4, clientX: 0, target, pointerId: 7 });
    await flushAsyncWork();
    world.drainActions();
    // Flick far right, then back to the start, before draining settles.
    world.dispatch("pointermove", { button: 1, buttons: 4, clientX: 320, target, pointerId: 7 });
    world.dispatch("pointermove", { button: 1, buttons: 4, clientX: 4, target, pointerId: 7 });
    await flushAsyncWork();
    await flushAsyncWork();
    world.dispatch("pointerup", { button: 1, buttons: 0, clientX: 4, target, pointerId: 7 });
    world.dispatch("auxclick", { button: 1, buttons: 0, target, pointerId: 7 });
    await flushAsyncWork();
    const moves = world.drainMessages().filter((m) => m.type === "TABWHEEL_MOVE_CURRENT_TAB").length;
    // The pointer ended where it began, so the tab must too. Target-seeking
    // means at most one move was already in flight when the reversal arrived;
    // it never replays the whole 3-slot excursion out and back.
    assert.ok(moves <= 2, `expected no excursion replay, got ${moves} moves`);
  } finally {
    world.cleanup();
  }
});
