import test from "node:test";
import assert from "node:assert/strict";
import { createGestureWorld, browserEventSequence, flushAsyncWork } from "./helpers/gestureHarness.mjs";

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
  pinTab: "TABWHEEL_TOGGLE_PIN",
  reloadTab: "TABWHEEL_RELOAD_TAB",
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

for (const action of CLICK_ACTIONS) {
  test(`right click mapped to ${action} fires once and leaks nothing on Windows (context menu after auxclick)`, async () => {
    const world = await createGestureWorld(settingsWith("rightClickAction", action));
    try {
      const { actions, leaked } = await world.performClick(2, { contextOn: "release" });
      assert.deepEqual(actions, [MESSAGE_FOR_ACTION[action]]);
      assert.deepEqual(leaked, [], "release-ordered right click should suppress every event too");
    } finally {
      world.cleanup();
    }
  });
}

test("Control + left click on macOS runs on its contextmenu, since no click follows", async () => {
  const world = await createGestureWorld({
    ...settingsWith("leftClickAction", "nativeNewTab"),
    gestureModifier: "ctrl",
  });
  try {
    const { actions, leaked } = await world.performClick(0, { alt: false, ctrl: true, macControlClick: true });
    assert.deepEqual(actions, ["TABWHEEL_OPEN_NATIVE_NEW_TAB"]);
    assert.deepEqual(leaked, [], "the context menu and the release must be suppressed");
  } finally {
    world.cleanup();
  }
});

test("a click held longer than the claim still runs once and leaks nothing", async () => {
  for (const { button, key } of BUTTONS) {
    for (const contextOn of ["press", "release"]) {
      const world = await createGestureWorld(settingsWith(key, "muteTab"));
      try {
        const leaked = [];
        for (const { type } of browserEventSequence(button, { contextOn })) {
          if (type === "pointerup") world.advance(2500);
          const eventButton = type === "click" ? 0 : button;
          if (!world.dispatch(type, { button: eventButton, alt: true }).defaultPrevented) leaked.push(type);
        }
        await flushAsyncWork();
        assert.deepEqual(world.drainActions(), ["TABWHEEL_TOGGLE_MUTE"], `button ${button}, context on ${contextOn}`);
        assert.deepEqual(leaked, [], `button ${button}, context on ${contextOn}`);
      } finally {
        world.cleanup();
      }
    }
  }
});

test("a press whose click never came cannot claim the next, unmodified click", async () => {
  const world = await createGestureWorld(settingsWith("leftClickAction", "closeToRecent"));
  try {
    // Alt + press, then the release is lost (focus change, native drag).
    world.dispatch("pointerdown", { button: 0, alt: true });
    world.dispatch("mousedown", { button: 0, alt: true });
    world.advance(300);
    const plain = await world.performClick(0, { alt: false });
    assert.deepEqual(plain.actions, [], "a plain click must never close the tab");
    assert.deepEqual(plain.leaked, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  } finally {
    world.cleanup();
  }
});

test("a pointerdown that is not a real mouse press does not end the click in progress", async () => {
  // A page script's synthetic pointerdown, and a touch contact, mid-press.
  for (const stray of [{ isTrusted: false }, { pointerType: "touch", pointerId: 9 }]) {
    const world = await createGestureWorld(settingsWith("leftClickAction", "muteTab"));
    try {
      const leaked = [];
      for (const { type } of browserEventSequence(0, {})) {
        if (type === "pointerup") world.dispatch("pointerdown", { button: 0, ...stray });
        if (!world.dispatch(type, { button: 0, alt: true }).defaultPrevented) leaked.push(type);
      }
      await flushAsyncWork();
      assert.deepEqual(world.drainActions(), ["TABWHEEL_TOGGLE_MUTE"], JSON.stringify(stray));
      assert.deepEqual(leaked, [], JSON.stringify(stray));
    } finally {
      world.cleanup();
    }
  }
});

test("a keyboard-made click or context menu after an action reaches the page", async () => {
  // Enter on a button, implicit form submission, and the Menu key all fire
  // trusted click/contextmenu events with no pointerdown before them.
  for (const [key, button, type] of [
    ["leftClickAction", 0, "click"],
    ["rightClickAction", 2, "contextmenu"],
  ]) {
    const world = await createGestureWorld(settingsWith(key, "muteTab"));
    try {
      await world.performClick(button);
      world.advance(1000);
      const keyboardEvent = world.dispatch(type, { button: 0 });
      assert.equal(keyboardEvent.defaultPrevented, false, `${type} must stay native`);
      assert.deepEqual(world.drainActions(), []);
    } finally {
      world.cleanup();
    }
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

test("a right-click action that switches tabs mid-press leaves no lasting claim on the hidden tab", async () => {
  const world = await createGestureWorld(settingsWith("rightClickAction", "recentTab"));
  try {
    // The action runs on the press-time contextmenu and the tab is hidden
    // before the release, which this document then never sees.
    world.dispatch("pointerdown", { button: 2, alt: true });
    world.dispatch("contextmenu", { button: 2, alt: true });
    globalThis.document.visibilityState = "hidden";
    world.dispatchDocument("visibilitychange");
    globalThis.document.visibilityState = "visible";
    world.dispatchDocument("visibilitychange");
    world.advance(1000);
    const keyboardMenu = world.dispatch("contextmenu", { button: 0 });
    assert.equal(keyboardMenu.defaultPrevented, false, "the Menu key must still open the context menu");
  } finally {
    world.cleanup();
  }
});
