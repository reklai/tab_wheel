import test from "node:test";
import assert from "node:assert/strict";
import { createGestureWorld } from "./helpers/gestureHarness.mjs";

// The modifier gate and the inverted-scroll setting, exercised through the
// real content-script pipeline. The gate is an exact match: the configured
// modifier must be down and every other modifier must be up, so a wrong
// modifier or an extra Shift leaves the page entirely native.

const BASE = {
  leftClickAction: "nativeNewTab",
  middleClickAction: "none",
  rightClickAction: "none",
};

const NEW_TAB = "TABWHEEL_OPEN_NATIVE_NEW_TAB";
const FULL_LEFT_SEQUENCE = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
const COARSE = { deltaY: 120, deltaMode: 0 };

function world(extra) {
  return createGestureWorld({ ...BASE, gestureModifier: "alt", gestureWithShift: false, invertScroll: false, ...extra });
}

// --- Alternate modifier keys ---

for (const [name, mod, flag] of [["Ctrl", "ctrl", "ctrl"], ["Meta / Command", "meta", "meta"]]) {
  test(`${name} configured: a ${name} click fires and an Alt click stays native`, async () => {
    const w = await world({ gestureModifier: mod });
    try {
      const correct = await w.performClick(0, { alt: false, [flag]: true });
      assert.deepEqual(correct.actions, [NEW_TAB], `${name} + click should fire`);
      assert.deepEqual(correct.leaked, [], `${name} + click should be suppressed`);

      const wrong = await w.performClick(0, { alt: true });
      assert.deepEqual(wrong.actions, [], "the wrong modifier must not fire");
      assert.deepEqual(wrong.leaked, FULL_LEFT_SEQUENCE, "the wrong modifier must stay native");
    } finally {
      w.cleanup();
    }
  });

  test(`${name} configured: a ${name} wheel switches and an Alt wheel is ignored`, async () => {
    const w = await world({ gestureModifier: mod });
    try {
      const correct = await w.wheel({ ...COARSE, alt: false, [flag]: true });
      assert.deepEqual(correct.cycles, ["next"]);
      assert.equal(correct.suppressed, true);

      const wrong = await w.wheel({ ...COARSE, alt: true });
      assert.deepEqual(wrong.cycles, []);
      assert.equal(wrong.suppressed, false, "the wrong modifier must leave the page scroll alone");
    } finally {
      w.cleanup();
    }
  });
}

// --- Require Shift ---

test("require Shift on: the modifier alone does nothing; modifier plus Shift fires", async () => {
  const w = await world({ gestureWithShift: true });
  try {
    const noShift = await w.performClick(0, { alt: true });
    assert.deepEqual(noShift.actions, [], "Alt alone must not fire when Shift is required");
    assert.deepEqual(noShift.leaked, FULL_LEFT_SEQUENCE);

    const withShift = await w.performClick(0, { alt: true, shift: true });
    assert.deepEqual(withShift.actions, [NEW_TAB], "Alt + Shift should fire when Shift is required");
    assert.deepEqual(withShift.leaked, []);
  } finally {
    w.cleanup();
  }
});

test("require Shift off: adding Shift breaks the exact match, so nothing fires", async () => {
  // The exact-match design is what lets Shift be a genuine conflict-avoider:
  // when Shift is not required, holding it must NOT trigger the gesture.
  const w = await world({ gestureWithShift: false });
  try {
    const withShift = await w.performClick(0, { alt: true, shift: true });
    assert.deepEqual(withShift.actions, []);
    assert.deepEqual(withShift.leaked, FULL_LEFT_SEQUENCE);
  } finally {
    w.cleanup();
  }
});

test("require Shift on: a modifier + Shift wheel switches, the modifier alone does not", async () => {
  const w = await world({ gestureWithShift: true });
  try {
    const withShift = await w.wheel({ ...COARSE, alt: true, shift: true });
    assert.deepEqual(withShift.cycles, ["next"]);

    const w2 = await world({ gestureWithShift: true });
    const noShift = await w2.wheel({ ...COARSE, alt: true });
    assert.deepEqual(noShift.cycles, []);
    assert.equal(noShift.suppressed, false);
    w2.cleanup();
  } finally {
    w.cleanup();
  }
});

// --- Inverted scroll ---

test("inverted scroll: wheel down moves to the previous tab, wheel up to the next", async () => {
  const w = await world({ invertScroll: true });
  try {
    const down = await w.wheel({ deltaY: 120, deltaMode: 0, alt: true });
    assert.deepEqual(down.cycles, ["prev"], "with inverted scroll, down means previous");
  } finally {
    w.cleanup();
  }
  const up = await world({ invertScroll: true });
  try {
    const result = await up.wheel({ deltaY: -120, deltaMode: 0, alt: true });
    assert.deepEqual(result.cycles, ["next"], "with inverted scroll, up means next");
  } finally {
    up.cleanup();
  }
});

test("normal scroll: wheel down moves to the next tab", async () => {
  const w = await world({ invertScroll: false });
  try {
    const down = await w.wheel({ deltaY: 120, deltaMode: 0, alt: true });
    assert.deepEqual(down.cycles, ["next"]);
  } finally {
    w.cleanup();
  }
});
