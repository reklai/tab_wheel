import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGestureWorld } from "./helpers/gestureHarness.mjs";

// The wheel gesture exercised through the real content-script pipeline, once
// per feel preset. A preset is the numeric knobs the UI writes when it is
// chosen (applyTabWheelPreset), so each profile here carries those knobs, the
// way a real user's stored settings would. The headline contract is how far
// the wheel must travel before a tab switch fires, which is what "feel" means.

// The knobs each preset writes, mirrored from TABWHEEL_PRESET_VALUES. The last
// test guards this copy against drift in the source.
const PROFILES = {
  precise: { wheelSensitivity: 0.8, wheelCooldownMs: 220, wheelAcceleration: false },
  balanced: { wheelSensitivity: 1, wheelCooldownMs: 160, wheelAcceleration: false },
  fast: { wheelSensitivity: 1.35, wheelCooldownMs: 90, wheelAcceleration: true },
  custom: { wheelSensitivity: 1, wheelCooldownMs: 160, wheelAcceleration: false },
};

// A clicky wheel notch on Linux reports line mode with deltaY 3, i.e. 48px.
const CLICKY = { deltaY: 3, deltaMode: 1, alt: true };
// A coarse free-spin / Chrome pixel-mode notch, ~120px.
const COARSE = { deltaY: 120, deltaMode: 0, alt: true };

const BASE = {
  gestureModifier: "alt",
  gestureWithShift: false,
  leftClickAction: "none",
  middleClickAction: "none",
  rightClickAction: "none",
};

function profileSettings(name) {
  return { ...BASE, wheelPreset: name, ...PROFILES[name] };
}

// A notch is floored at WHEEL_NOTCH_PX (100px) whatever the OS reports, and
// every preset's trigger (80 / sensitivity, at most 100px for Precise) is
// within one notch: one detent, one tab. Presets differ in cooldown and in how
// far a trackpad travels; only a custom sensitivity below 0.8 asks for two.
const EXPECTED_CLICKY_NOTCHES = { precise: 1, balanced: 1, fast: 1, custom: 1 };

for (const name of Object.keys(PROFILES)) {
  test(`${name}: a clicky wheel switches tabs after ${EXPECTED_CLICKY_NOTCHES[name]} notch`, async () => {
    const world = await createGestureWorld(profileSettings(name));
    try {
      const { notches, direction } = await world.notchesToFirstCycle(CLICKY);
      assert.equal(notches, EXPECTED_CLICKY_NOTCHES[name]);
      assert.equal(direction, "next");
    } finally {
      world.cleanup();
    }
  });

  test(`${name}: a coarse pixel-mode notch switches on the first notch`, async () => {
    const world = await createGestureWorld(profileSettings(name));
    try {
      const { notches } = await world.notchesToFirstCycle(COARSE);
      assert.equal(notches, 1);
    } finally {
      world.cleanup();
    }
  });

  test(`${name}: wheel up moves to the previous tab, wheel down to the next`, async () => {
    const world = await createGestureWorld(profileSettings(name));
    try {
      const down = await world.notchesToFirstCycle({ ...COARSE });
      assert.equal(down.direction, "next");
    } finally {
      world.cleanup();
    }
    const up = await createGestureWorld(profileSettings(name));
    try {
      const result = await up.notchesToFirstCycle({ deltaY: -120, deltaMode: 0, alt: true });
      assert.equal(result.direction, "prev");
    } finally {
      up.cleanup();
    }
  });

  test(`${name}: a plain wheel with no modifier is left entirely to the page`, async () => {
    const world = await createGestureWorld(profileSettings(name));
    try {
      const { suppressed, cycles } = await world.wheel({ deltaY: 120, deltaMode: 0, alt: false });
      assert.equal(suppressed, false, "an unmodified scroll must not be preventDefaulted");
      assert.deepEqual(cycles, [], "an unmodified scroll must not switch tabs");
    } finally {
      world.cleanup();
    }
  });

  test(`${name}: a modifier wheel below the trigger is claimed but does not switch`, async () => {
    const world = await createGestureWorld(profileSettings(name));
    try {
      // A short trackpad slice: continuous pixel input with the precise echo.
      const { suppressed, cycles } = await world.wheel({ deltaY: 12, deltaMode: 0, wheelDeltaY: -36, alt: true });
      assert.equal(suppressed, true, "the page must not also scroll during a gesture");
      assert.deepEqual(cycles, [], "a short trackpad slice is below every profile's trigger");
    } finally {
      world.cleanup();
    }
  });
}

test("a custom sensitivity below 0.8 asks for two notches per switch", async () => {
  const world = await createGestureWorld({ ...profileSettings("custom"), wheelSensitivity: 0.5 });
  try {
    const { notches } = await world.notchesToFirstCycle(CLICKY);
    assert.equal(notches, 2);
  } finally {
    world.cleanup();
  }
});

test("the profile knobs in this test still match the source presets", () => {
  const contract = readFileSync(
    resolve(process.cwd(), "src/lib/common/contracts/tabWheel.ts"),
    "utf8",
  );
  const block = contract.slice(
    contract.indexOf("TABWHEEL_PRESET_VALUES"),
    contract.indexOf("DEFAULT_TABWHEEL_SETTINGS"),
  );
  for (const preset of ["precise", "balanced", "fast"]) {
    const knobs = PROFILES[preset];
    assert.match(block, new RegExp(`${preset}:\\s*\\{[^}]*wheelSensitivity:\\s*${knobs.wheelSensitivity}\\b`), preset);
    assert.match(block, new RegExp(`${preset}:\\s*\\{[^}]*wheelCooldownMs:\\s*${knobs.wheelCooldownMs}\\b`), preset);
    assert.match(block, new RegExp(`${preset}:\\s*\\{[^}]*wheelAcceleration:\\s*${knobs.wheelAcceleration}\\b`), preset);
  }
});
