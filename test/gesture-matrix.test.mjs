import test from "node:test";
import assert from "node:assert/strict";
import { createGestureWorld, browserEventSequence } from "./helpers/gestureHarness.mjs";

// The full contract for a modifier + mouse-button click action, exercised
// against the real content-script pipeline. A mapped button must fire its
// action exactly once and let no event of the interaction reach the page; an
// Off button must fire nothing and suppress nothing.

const MESSAGE_FOR_ACTION = {
  nativeNewTab: "TABWHEEL_OPEN_NATIVE_NEW_TAB",
  recentTab: "TABWHEEL_ACTIVATE_MOST_RECENT_TAB",
  closeToRecent: "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT",
  duplicateTab: "TABWHEEL_DUPLICATE_TAB",
  muteTab: "TABWHEEL_TOGGLE_MUTE",
  goBack: "TABWHEEL_GO_BACK",
  goForward: "TABWHEEL_GO_FORWARD",
  openSettings: "TABWHEEL_OPEN_OPTIONS",
};

const BUTTONS = [
  { name: "left", button: 0, key: "leftClickAction" },
  { name: "middle", button: 1, key: "middleClickAction" },
  { name: "right", button: 2, key: "rightClickAction" },
];

const CLICK_ACTIONS = Object.keys(MESSAGE_FOR_ACTION);

function settingsWith(key, action) {
  return {
    gestureModifier: "alt",
    gestureWithShift: false,
    allowGesturesInEditableFields: false,
    leftClickAction: "none",
    middleClickAction: "none",
    rightClickAction: "none",
    [key]: action,
  };
}

test("smoke: the harness runs the real pipeline and the default left action fires", async () => {
  const world = await createGestureWorld(settingsWith("leftClickAction", "nativeNewTab"));
  try {
    const { actions, leaked } = await world.performClick(0);
    assert.deepEqual(actions, ["TABWHEEL_OPEN_NATIVE_NEW_TAB"]);
    assert.deepEqual(leaked, [], "no event should reach the page");
  } finally {
    world.cleanup();
  }
});

for (const { name, button, key } of BUTTONS) {
  for (const action of CLICK_ACTIONS) {
    test(`${name} click mapped to ${action} fires once and leaks nothing (context on press)`, async () => {
      const world = await createGestureWorld(settingsWith(key, action));
      try {
        const { actions, leaked } = await world.performClick(button, { contextOn: "press" });
        assert.deepEqual(actions, [MESSAGE_FOR_ACTION[action]], `${name}/${action} should fire exactly once`);
        assert.deepEqual(leaked, [], `${name}/${action} should suppress every event of the interaction`);
      } finally {
        world.cleanup();
      }
    });
  }

  test(`${name} click set to Off fires nothing and passes every event through`, async () => {
    const world = await createGestureWorld(settingsWith(key, "none"));
    try {
      const { actions, leaked } = await world.performClick(button, { contextOn: "press" });
      const expected = browserEventSequence(button, { contextOn: "press" }).map((event) => event.type);
      assert.deepEqual(actions, [], `${name}/Off should fire no action`);
      assert.deepEqual(leaked, expected, `${name}/Off should leave every event native`);
    } finally {
      world.cleanup();
    }
  });
}

test("right click on Windows (context menu on release) also leaks nothing", async () => {
  const world = await createGestureWorld(settingsWith("rightClickAction", "muteTab"));
  try {
    const { actions, leaked } = await world.performClick(2, { contextOn: "release" });
    assert.deepEqual(actions, ["TABWHEEL_TOGGLE_MUTE"]);
    assert.deepEqual(leaked, [], "release-ordered right click should suppress every event too");
  } finally {
    world.cleanup();
  }
});

test("a double left click on a toggle fires twice and never hands the page a dblclick", async () => {
  const world = await createGestureWorld(settingsWith("leftClickAction", "muteTab"));
  try {
    const { actions, leaked } = await world.performClick(0, { double: true });
    assert.deepEqual(actions, ["TABWHEEL_TOGGLE_MUTE", "TABWHEEL_TOGGLE_MUTE"]);
    assert.deepEqual(leaked, [], "dblclick and both clicks must be suppressed");
  } finally {
    world.cleanup();
  }
});

test("without the modifier held, nothing is claimed and every event is native", async () => {
  const world = await createGestureWorld(settingsWith("leftClickAction", "nativeNewTab"));
  try {
    const { actions, leaked } = await world.performClick(0, { alt: false });
    assert.deepEqual(actions, []);
    assert.deepEqual(leaked, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  } finally {
    world.cleanup();
  }
});

test("editable-field gestures are always on, so a gesture over an input still fires", async () => {
  // allowGesturesInEditableFields is a forced-on internal rule, documented in
  // the store copy. A modifier + click inside a text field must still work.
  const world = await createGestureWorld(settingsWith("leftClickAction", "nativeNewTab"));
  try {
    const editable = new world.MockEditable("input");
    const { actions, leaked } = await world.performClick(0, { target: editable });
    assert.deepEqual(actions, ["TABWHEEL_OPEN_NATIVE_NEW_TAB"]);
    assert.deepEqual(leaked, [], "the gesture claims the interaction even over an input");
  } finally {
    world.cleanup();
  }
});

test("after an action the claim never bleeds into the next interaction", async () => {
  const world = await createGestureWorld(settingsWith("rightClickAction", "muteTab"));
  try {
    await world.performClick(2, { contextOn: "press" });
    // A following plain left click (no modifier) must reach the page untouched.
    const plain = await world.performClick(0, { alt: false });
    assert.deepEqual(plain.actions, []);
    assert.deepEqual(plain.leaked, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  } finally {
    world.cleanup();
  }
});
