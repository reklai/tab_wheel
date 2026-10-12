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
    // Fingers travel 56px (one switch at 50px), then lift into a long,
    // flagged inertia tail worth several more switches.
    const finger = [4, 8, 12, 16, 16].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
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
    const finger = [6, 10, 12, 10].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
    const inertia = Array.from({ length: 60 }, (_, index) => ({
      ...trackpadEvent(10 * 0.998 ** ((index + 1) * 16)),
      momentum: true,
      advanceMs: 16,
    }));
    // 38px of finger travel falls short of 50px; the inertia is swallowed and
    // the short swipe's leftover distance is dropped with it.
    assert.equal(await countCycles(world, [...finger, ...inertia]), 0);
    const nextShortSwipe = [6, 10, 12, 10].map((deltaY) => ({ ...trackpadEvent(deltaY), advanceMs: 16 }));
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
      const swipe = [6, 10, 12, 10].map((deltaY) => ({ deltaMode: 0, deltaY, advanceMs: 16 }));
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
      const perEvent = 60 / fingerEvents;
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

test("a busy page that delivers inertia late and in clumps still switches exactly once", async () => {
  // The same unflagged 60Hz swipe as above, but the page's main thread stalls:
  // every 96ms it wakes and receives the six wheel events queued meanwhile, all
  // at once. Each event still carries the time its input happened, and the
  // guards read that, so the stalls neither end the momentum session (which a
  // 96ms gap would) nor hide the tail's decay.
  await withWorld(async (world) => {
    const gapMs = 16;
    const perEvent = 10;
    const finger = Array.from({ length: 6 }, () => ({ deltaMode: 0, deltaY: perEvent, advanceMs: gapMs }));
    assert.equal(await countCycles(world, finger), 1);
    const happenedFrom = world.now();
    let cycles = 0;
    for (let index = 0; index < 75; index += 1) {
      if (index % 6 === 0) world.advance(96);
      const result = await world.wheel({
        alt: true,
        deltaMode: 0,
        deltaY: perEvent * 0.998 ** ((index + 1) * gapMs),
        timeStamp: happenedFrom + (index + 1) * gapMs,
      });
      cycles += result.cycles.length;
    }
    assert.equal(cycles, 0, "the clumped inertia tail switched tabs");
  });
});

test("an input clock that drifted from the page clock does not disturb switching", async () => {
  // After the machine sleeps, a platform's input timestamps can sit hours away
  // from performance.now(). Such a timestamp is ignored for the handling time,
  // so notches still switch one tab each and the cooldown still paces them.
  await withWorld(async (world) => {
    world.dispatchDocument("visibilitychange");
    let cycles = 0;
    for (let index = 0; index < 4; index += 1) {
      world.advance(300);
      const result = await world.wheel({ alt: true, deltaMode: 0, deltaY: 12, timeStamp: world.now() - 7_200_000 });
      cycles += result.cycles.length;
    }
    for (let index = 0; index < 10; index += 1) {
      const result = await world.wheel({ alt: true, deltaMode: 0, deltaY: 12, advanceMs: 16, timeStamp: world.now() - 7_200_000 + 16 });
      cycles += result.cycles.length;
    }
    assert.ok(cycles >= 1, "a steady swipe with a drifted input clock never switched");
  });
});

// A browser that flags inertia marks every event: true on inertia, false on
// the user's own motion.
const flaggedFinger = (deltaY, extra = {}) => ({ ...trackpadEvent(deltaY), momentum: false, advanceMs: 16, ...extra });

test("with Chrome's inertia flag, fingers easing off after a switch still count", async () => {
  // A quick stroke switches once, then the fingers keep moving and slow down
  // smoothly. That deceleration looks exactly like inertia to the fallback
  // guard, which swallows it; the flag says it is the user, so it counts.
  const stroke = [20, 20, 10];
  const easingOff = Array.from({ length: 8 }, (_, index) => 10 * 0.95 ** index);
  await withWorld(async (world) => {
    assert.equal(await countCycles(world, stroke.map((deltaY) => flaggedFinger(deltaY))), 1);
    assert.equal(await countCycles(world, easingOff.map((deltaY) => flaggedFinger(deltaY))), 1);
  });
  await withWorld(async (world) => {
    const unflagged = (deltaY) => ({ deltaMode: 0, deltaY, advanceMs: 16 });
    assert.equal(await countCycles(world, stroke.map(unflagged)), 1);
    assert.equal(await countCycles(world, easingOff.map(unflagged)), 0, "the fallback guard still treats this as inertia");
  });
});

test("with Chrome's inertia flag, the first motion in a newly shown tab counts", async () => {
  // The arrival guard exists to catch an unflagged tail handed to the next
  // tab. With the flag, a tail is already marked, so nothing is dropped.
  await withWorld(async (world) => {
    world.dispatchDocument("visibilitychange");
    const swipe = [20, 20, 20].map((deltaY) => flaggedFinger(deltaY));
    assert.equal(await countCycles(world, swipe), 1);
  });
  await withWorld(async (world) => {
    world.dispatchDocument("visibilitychange");
    const swipe = [20, 20, 20].map((deltaY) => ({ deltaMode: 0, deltaY, advanceMs: 16 }));
    assert.equal(await countCycles(world, swipe), 0, "without the flag the guard holds the same motion back");
  });
});

test("a diagonal swipe is read on one axis and does not cancel itself", async () => {
  // Down and to the left: vertical says next, horizontal says previous. Read
  // per event, the sideways-leaning events subtract from the vertical ones.
  await withWorld(async (world) => {
    const swipe = [
      [14, -6], [12, -8], [9, -13], [8, -14], [13, -7],
    ].map(([deltaY, deltaX]) => ({ deltaMode: 0, deltaY, deltaX, wheelDeltaY: -3 * deltaY, wheelDeltaX: -3 * deltaX, momentum: false, advanceMs: 16 }));
    let directions = [];
    for (const event of swipe) directions = directions.concat((await world.wheel({ alt: true, ...event })).cycles);
    assert.deepEqual(directions, ["next"], "56px of downward travel is one tab forward");
  });
});

test("a sideways swipe locks to the horizontal axis", async () => {
  await withWorld(async (world) => {
    const swipe = Array.from({ length: 4 }, (_, index) => ({
      deltaMode: 0, deltaX: -14, deltaY: index % 2 ? 3 : -3, wheelDeltaX: 42, wheelDeltaY: index % 2 ? -9 : 9, momentum: false, advanceMs: 16,
    }));
    let directions = [];
    for (const event of swipe) directions = directions.concat((await world.wheel({ alt: true, ...event })).cycles);
    assert.deepEqual(directions, ["prev"]);
  });
});

test("each swipe picks its own axis", async () => {
  await withWorld(async (world) => {
    const sideways = Array.from({ length: 4 }, () => ({ deltaMode: 0, deltaX: 14, deltaY: 1, momentum: false, advanceMs: 16 }));
    assert.equal(await countCycles(world, sideways), 1);
    world.advance(600);
    const vertical = Array.from({ length: 4 }, () => ({ deltaMode: 0, deltaX: 1, deltaY: -14, momentum: false, advanceMs: 16 }));
    let directions = [];
    for (const event of vertical) directions = directions.concat((await world.wheel({ alt: true, ...event })).cycles);
    assert.deepEqual(directions, ["prev"], "the second swipe is read vertically");
  });
});

// --- Distance-only switching for continuous devices ---

// A flagged-browser swipe covering `totalPx` at `pxPerEvent` per 8ms event
// (negative for upward).
function steadySwipe(totalPx, pxPerEvent) {
  return Array.from({ length: Math.round(totalPx / Math.abs(pxPerEvent)) }, () => ({
    ...trackpadEvent(pxPerEvent), momentum: false, advanceMs: 8,
  }));
}

test("the same finger travel switches the same number of tabs at any speed", async () => {
  // 240px of travel is four tabs (50px each) whether it takes two seconds
  // or a tenth of one. No cooldown paces a swipe and no travel is
  // discarded.
  for (const pxPerEvent of [1, 4, 10, 30]) {
    await withWorld(async (world) => {
      assert.equal(await countCycles(world, steadySwipe(240, pxPerEvent)), 4, `${pxPerEvent}px per event`);
    });
  }
});

test("a swipe keeps its remainder, so two half steps make one tab", async () => {
  await withWorld(async (world) => {
    assert.equal(await countCycles(world, steadySwipe(40, 4)), 0);
    assert.equal(await countCycles(world, steadySwipe(40, 4)), 1, "80px in all crosses one 50px step");
  });
});

test("reversing mid-swipe walks back the other way", async () => {
  await withWorld(async (world) => {
    let directions = [];
    for (const event of [...steadySwipe(130, 10), ...steadySwipe(130, -10)]) {
      directions = directions.concat((await world.wheel({ alt: true, ...event })).cycles);
    }
    assert.deepEqual(directions, ["next", "next", "prev", "prev"]);
  });
});

test("the Sensitivity setting scales the travel per tab; cooldown and acceleration do not", async () => {
  // 380px at 50px (1.0x), 100px (0.5x), and 25px (2.0x) per tab.
  for (const [wheelSensitivity, expected] of [[0.5, 3], [1, 7], [2, 15]]) {
    const world = await createGestureWorld({ ...SETTINGS, wheelSensitivity });
    try {
      assert.equal(await countCycles(world, steadySwipe(380, 8)), expected, `sensitivity ${wheelSensitivity}`);
    } finally {
      world.cleanup();
    }
  }
  // The longest cooldown, and acceleration, leave the swipe exactly as it was.
  const world = await createGestureWorld({ ...SETTINGS, wheelCooldownMs: 400, wheelAcceleration: true });
  try {
    assert.equal(await countCycles(world, steadySwipe(380, 8)), 7);
  } finally {
    world.cleanup();
  }
});

test("a clump of queued input cannot fly through the tab strip", async () => {
  await withWorld(async (world) => {
    const { cycles } = await world.wheel({ alt: true, ...trackpadEvent(900), momentum: false });
    assert.equal(cycles.length, 3, "one event switches at most three tabs");
    // The travel past the cap is gone, not held back as a step ready to fire.
    const next = await world.wheel({ alt: true, ...trackpadEvent(1), momentum: false, advanceMs: 8 });
    assert.equal(next.cycles.length, 0, "the next delta does not fire a fourth switch");
  });
});

test("a carry never switches tabs on its own", async () => {
  for (const remainderPx of [50, 120, -50]) {
    await withWorld(async (world) => {
      world.setVisibility("hidden");
      world.setVisibility("visible");
      world.drainMessages();
      world.deliverMessage({ type: "TABWHEEL_SWIPE_CARRY", remainderPx, axis: "y" });
      const cycled = world.drainMessages().some((message) => message.type === "TABWHEEL_CYCLE");
      assert.equal(cycled, false, `a ${remainderPx}px carry`);
    });
  }
});

test("a carry with an axis that is not x or y leaves the swipe working", async () => {
  await withWorld(async (world) => {
    world.setVisibility("hidden");
    world.setVisibility("visible");
    world.drainMessages();
    world.deliverMessage({ type: "TABWHEEL_SWIPE_CARRY", remainderPx: 30, axis: "z" });
    assert.equal(await countCycles(world, steadySwipe(16, 8)), 0, "30px carried plus 16px is under one step");
    assert.equal(await countCycles(world, steadySwipe(16, 8)), 1, "62px in all crosses one 50px step");
  });
});

test("a notched wheel is still paced by its cooldown", async () => {
  await withWorld(async (world) => {
    const spin = Array.from({ length: 8 }, () => ({ deltaMode: 0, deltaY: 120, wheelDeltaY: -120, advanceMs: 20 }));
    assert.equal(await countCycles(world, spin), 1, "eight notches in 160ms is one switch at Balanced");
  });
});

test("a swipe hands its unspent distance to the tab it switched to", async () => {
  await withWorld(async (world) => {
    // 80px here: one switch, 30px left over as the tab is hidden.
    assert.equal(await countCycles(world, steadySwipe(80, 4)), 1);
    world.setVisibility("hidden");
    const handoff = world.drainMessages().find((message) => message.type === "TABWHEEL_SWIPE_HANDOFF");
    assert.ok(handoff, "the remainder is handed off");
    assert.equal(Math.round(handoff.remainderPx), 30);
    assert.equal(handoff.axis, "y");
  });
});

test("a swipe that already ended hands nothing off", async () => {
  await withWorld(async (world) => {
    await countCycles(world, steadySwipe(80, 4));
    world.advance(500);
    world.setVisibility("hidden");
    assert.equal(world.drainMessages().some((message) => message.type === "TABWHEEL_SWIPE_HANDOFF"), false);
  });
  // Lifting the fingers (flagged inertia) ends the swipe and its remainder.
  await withWorld(async (world) => {
    await countCycles(world, steadySwipe(80, 4));
    await world.wheel({ alt: true, ...trackpadEvent(6), momentum: true, advanceMs: 8 });
    world.setVisibility("hidden");
    assert.equal(world.drainMessages().some((message) => message.type === "TABWHEEL_SWIPE_HANDOFF"), false);
  });
});

test("the newly shown tab continues the swipe from the carried distance", async () => {
  // 30px carried in plus 32px here crosses the 50px step, whichever of the
  // carry and the first delta arrives first.
  for (const carryFirst of [true, false]) {
    await withWorld(async (world) => {
      world.setVisibility("hidden");
      world.setVisibility("visible");
      world.drainMessages();
      const carry = { type: "TABWHEEL_SWIPE_CARRY", remainderPx: 30, axis: "y" };
      let cycles = 0;
      if (carryFirst) world.deliverMessage(carry);
      cycles += await countCycles(world, steadySwipe(16, 8));
      if (!carryFirst) world.deliverMessage(carry);
      cycles += await countCycles(world, steadySwipe(16, 8));
      assert.equal(cycles, 1, carryFirst ? "carry first" : "first delta first");
    });
  }
});

test("a carry is ignored by a tab that has been visible for a while", async () => {
  await withWorld(async (world) => {
    world.setVisibility("hidden");
    world.setVisibility("visible");
    world.advance(2000);
    world.deliverMessage({ type: "TABWHEEL_SWIPE_CARRY", remainderPx: 45, axis: "y" });
    assert.equal(await countCycles(world, steadySwipe(16, 8)), 0);
  });
});

test("a long deliberate trackpad swipe still moves several tabs", async () => {
  await withWorld(async (world) => {
    // 600ms of steady finger travel at 12px/16ms = 450px.
    const swipe = Array.from({ length: 38 }, () => ({ ...trackpadEvent(12), advanceMs: 16 }));
    const cycles = await countCycles(world, swipe);
    assert.ok(cycles >= 3, `a 450px swipe switched only ${cycles} tabs`);
  });
});
