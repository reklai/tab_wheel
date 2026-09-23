import test from "node:test";
import assert from "node:assert/strict";
import { createGestureWorld } from "./helpers/gestureHarness.mjs";

// Real device event shapes replayed through the real content-script pipeline
// at the default Balanced preset. The contract is the same on every OS: one
// detent of a notched wheel switches one tab, and a trackpad swipe switches by
// how far the fingers travelled, never by the inertia that follows.

const SETTINGS = {
  gestureModifier: "alt",
  gestureWithShift: false,
  leftClickAction: "none",
  middleClickAction: "none",
  rightClickAction: "none",
};

async function withWorld(run, { devicePixelRatio = 1 } = {}) {
  const world = await createGestureWorld(SETTINGS);
  world.setDevicePixelRatio(devicePixelRatio);
  try {
    await run(world);
  } finally {
    world.cleanup();
  }
}

async function countCycles(world, events) {
  let cycles = 0;
  for (const event of events) {
    const result = await world.wheel({ alt: true, ...event });
    cycles += result.cycles.length;
  }
  return cycles;
}

// Chrome on macOS, notched mouse: macOS scales a slow notch down to 0.1 of a
// line (4.000244140625px), while wheelDelta carries the raw notch (+/-120,
// divided by devicePixelRatio and truncated).
function macChromeNotch(deltaY, devicePixelRatio = 1) {
  return {
    deltaMode: 0,
    deltaY,
    wheelDeltaY: Math.trunc((-120 * Math.sign(deltaY)) / devicePixelRatio),
  };
}

// A precise (trackpad / Magic Mouse) event: wheelDelta echoes deltaY x -3.
function trackpadEvent(deltaY, extra = {}) {
  return { deltaMode: 0, deltaY, wheelDeltaY: Math.trunc(-3 * deltaY), ...extra };
}

test("a slow Mac mouse notch in Chrome switches one tab per notch", async () => {
  await withWorld(async (world) => {
    const notches = Array.from({ length: 5 }, () => ({ ...macChromeNotch(4.000244140625), advanceMs: 400 }));
    assert.equal(await countCycles(world, notches), 5);
  });
});

test("the Mac notch is recognized on Retina screens and zoomed pages", async () => {
  for (const devicePixelRatio of [2, 2.2, 1.5]) {
    await withWorld(async (world) => {
      const notches = Array.from({ length: 3 }, () => ({
        ...macChromeNotch(4.000244140625 / devicePixelRatio, devicePixelRatio),
        advanceMs: 400,
      }));
      assert.equal(await countCycles(world, notches), 3, `devicePixelRatio ${devicePixelRatio}`);
    }, { devicePixelRatio });
  }
});

test("macOS wheel acceleration no longer decides how far the wheel travels", async () => {
  // The same four notches, turned slowly (4px each) and quickly (accelerated
  // to 40-200px each), switch the same number of tabs once the cooldown is
  // respected: the notch count decides, not the OS scaling.
  await withWorld(async (world) => {
    const slow = [4, 4, 4, 4].map((deltaY) => ({ ...macChromeNotch(deltaY + 0.000244140625), advanceMs: 200 }));
    const quick = [48, 120, 200, 160].map((deltaY) => ({ ...macChromeNotch(deltaY), advanceMs: 200 }));
    assert.equal(await countCycles(world, slow), 4);
    world.advance(1000);
    assert.equal(await countCycles(world, quick), 4);
  });
});

test("a fast spin is paced by the cooldown, not multiplied by acceleration", async () => {
  await withWorld(async (world) => {
    // Twelve accelerated notches 20ms apart: 240ms of spinning at a 160ms
    // cooldown can only land two switches.
    const spin = Array.from({ length: 12 }, () => ({ ...macChromeNotch(180), advanceMs: 20 }));
    const cycles = await countCycles(world, spin);
    assert.ok(cycles >= 1 && cycles <= 2, `a 240ms spin switched ${cycles} tabs`);
  });
});

test("a trackpad is never mistaken for a notch, even at a whole-tick delta", async () => {
  await withWorld(async (world) => {
    // 40px x -3 = -120: a whole tick, but the precise echo marks it continuous.
    const { cycles } = await world.wheel({ alt: true, ...trackpadEvent(40) });
    assert.deepEqual(cycles, []);
  });
});

test("Chrome's momentum flag: trackpad inertia never switches tabs", async () => {
  await withWorld(async (world) => {
    // Fingers travel 96px (one switch at 80px), then lift into a long,
    // flagged inertia tail worth several more switches.
    const finger = [4, 8, 12, 16, 16, 16, 12, 12].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
    const inertia = Array.from({ length: 90 }, (_, index) => ({
      ...trackpadEvent(16 * 0.998 ** ((index + 1) * 16)),
      momentum: true,
      advanceMs: 16,
    }));
    assert.equal(await countCycles(world, finger), 1);
    assert.equal(await countCycles(world, inertia), 0);
  });
});

test("Chrome's momentum flag: inertia cannot finish a swipe the fingers did not", async () => {
  await withWorld(async (world) => {
    const finger = [6, 10, 14, 14, 10].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
    const inertia = Array.from({ length: 60 }, (_, index) => ({
      ...trackpadEvent(10 * 0.998 ** ((index + 1) * 16)),
      momentum: true,
      advanceMs: 16,
    }));
    // 54px of finger travel falls short of 80px; the inertia is swallowed and
    // the short swipe's leftover distance is dropped with it.
    assert.equal(await countCycles(world, [...finger, ...inertia]), 0);
    const nextShortSwipe = [6, 10, 14, 14, 10].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
    world.advance(400);
    assert.equal(await countCycles(world, nextShortSwipe), 0, "a stale partial swipe carried over");
  });
});

test("the same short swipe gives the same result every time", async () => {
  // Without a momentum flag (Chrome before 151): a swipe that falls short of the
  // trigger used to bank its distance forever, so every second identical
  // swipe switched. A pause ends the swipe and its leftover distance.
  await withWorld(async (world) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      world.advance(600);
      const swipe = [6, 10, 14, 14, 10].map((deltaY) => ({ deltaMode: 0, deltaY, advanceMs: 16 }));
      assert.equal(await countCycles(world, swipe), 0, `attempt ${attempt + 1}`);
    }
  });
});

for (const { label, gapMs } of [{ label: "60Hz", gapMs: 16 }, { label: "120Hz", gapMs: 8 }]) {
  test(`without a momentum flag, one ${label} swipe and its inertia switch exactly once`, async () => {
    // Chrome before 151 on a Mac trackpad: pixel mode, no wheelDelta ticks, no
    // momentum flag. A steady finger swipe, then macOS inertia (~0.2%/ms).
    await withWorld(async (world) => {
      const fingerEvents = Math.round(96 / gapMs);
      const perEvent = 100 / fingerEvents;
      const finger = Array.from({ length: fingerEvents }, () => ({ deltaMode: 0, deltaY: perEvent, advanceMs: gapMs }));
      const inertia = Array.from({ length: Math.round(1200 / gapMs) }, (_, index) => ({
        deltaMode: 0,
        deltaY: perEvent * 0.998 ** ((index + 1) * gapMs),
        advanceMs: gapMs,
      }));
      assert.equal(await countCycles(world, [...finger, ...inertia]), 1);
    });
  });
}

test("a long deliberate trackpad swipe still moves several tabs", async () => {
  await withWorld(async (world) => {
    // 600ms of steady finger travel at 12px/16ms = 450px.
    const swipe = Array.from({ length: 38 }, () => ({ ...trackpadEvent(12), advanceMs: 16 }));
    const cycles = await countCycles(world, swipe);
    assert.ok(cycles >= 3, `a 450px swipe switched only ${cycles} tabs`);
  });
});
