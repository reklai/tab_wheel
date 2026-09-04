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
