import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");
const assertOrdered = (text, snippets) => {
  let cursor = -1;
  for (const snippet of snippets) {
    const index = text.indexOf(snippet);
    assert.ok(index > cursor, `${snippet} should follow the previous control`);
    cursor = index;
  }
};

test("runtime contract is limited to wheel operations and opening settings", () => {
  const contract = readText("src/lib/common/contracts/runtimeMessages.ts");
  const handler = readText("src/lib/backgroundRuntime/handlers/tabWheelMessageHandler.ts");
  const api = readText("src/lib/adapters/runtime/tabWheelApi.ts");

  assert.match(contract, /TABWHEEL_CYCLE/);
  assert.match(contract, /source:\s*TabWheelCycleSource/);
  assert.match(contract, /TABWHEEL_SAVE_SCROLL_POSITION/);
  assert.match(contract, /TABWHEEL_OPEN_OPTIONS/);
  assert.match(handler, /domain\.cycle\(message\.direction,\s*message\.source,\s*sender\.tab\)/);
  assert.match(handler, /browser\.runtime\.openOptionsPage\(\)/);
  assert.match(handler, /return \{ ok: true \}/);
  assert.match(handler, /return \{ ok: false,\s*reason: "Settings unavailable" \}/);
  assert.match(api, /source:\s*TabWheelCycleSource/);
  assert.match(api, /openTabWheelOptions/);
  assert.doesNotMatch(`${contract}\n${api}`, /SEARCH|DUPLICATE|CLOSE_TAB|NEW_TAB/);
});

test("content script owns the wheel chord and only the focused middle-click exception", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const middleClickCore = readText("src/lib/core/tabWheel/middleClickCore.ts");

  assert.match(app, /isTabWheelModifier\(event,\s*settings\.gestureModifier,\s*settings\.gestureWithShift\)/);
  assert.match(app, /window\.addEventListener\("wheel",\s*wheelHandler,\s*\{\s*passive:\s*false,\s*capture:\s*true\s*\}\)/);
  assert.match(app, /cycleTabWheel\(direction,\s*"gesture"\)/);
  assert.match(app, /settings\.middleClickAction === "openSettings"/);
  assert.match(app, /window\.addEventListener\("pointerdown",\s*middleClickHandler,\s*true\)/);
  assert.match(app, /window\.addEventListener\("auxclick",\s*middleClickHandler,\s*true\)/);
  assert.match(app, /openTabWheelOptions\(\)/);
  assert.match(middleClickCore, /event\.button === 1/);
  assert.doesNotMatch(app, /contextmenu|rightClickAction|leftClickAction/);
  assert.doesNotMatch(app, /pageScrollSpeedMultiplier|pageScrollViewportCapRatio|scalePageScroll/);
});

test("wheel sampling, device tuning, and the momentum guard are wired into the gesture path", () => {
  const app = readText("src/lib/appInit/appInit.ts");

  // Sampling has to precede the modifier check: unmodified scrolling and
  // momentum tails are the evidence the classifier needs. Suppression comes
  // before both guard steps so a swallowed tail cannot scroll the page either,
  // and both run before accumulation so their deltas are dropped, not banked.
  const wheelHandlerSource = app.slice(app.indexOf("function wheelHandler"));
  assertOrdered(wheelHandlerSource, [
    "if (!event.isTrusted) return;",
    "addWheelSample(",
    "if (!isKeyboardWheelEvent(event)) return;",
    "suppressPageEvent(event);",
    "createMomentumGuardSession(",
    "shouldBlockWheelDelta(",
    "wheelAccumulator += wheelDelta;",
  ]);
  assert.match(app, /momentumGuardSession\s*\n\s*&& shouldBlockWheelDelta\(/);

  // Samples stay content-free and local: timing, deltaMode, magnitude only.
  assertOrdered(app, [
    "timeStampMs: now",
    "deltaMode: event.deltaMode",
    "deltaMagnitudePx: wheelMagnitudePx",
  ]);
  assert.doesNotMatch(app, /storage\.local\.set|JSON\.stringify/);
  // A zero-magnitude event carries no cadence evidence and must not be
  // recorded as an observation.
  assert.match(app, /if \(wheelMagnitudePx > 0\) \{\s*\n\s*addWheelSample\(/);

  // Classification is lazy and gated: off means an exact identity adjustment.
  assert.match(app, /if \(!settings\.deviceAwareTuning\) return resolveDeviceTuningAdjustment\("unknown"\);/);
  assert.match(app, /return resolveDeviceTuningAdjustment\(classifyWheelDevice\(wheelSampleWindow\)\);/);

  // Effective values only — stored settings and presets are untouched.
  assert.match(app, /const triggerDistance = acceleratedDistance \* deviceAdjustment\.triggerDistanceMultiplier;/);

  // Notch-adaptive trigger: a detented wheel's own notch magnitude can only
  // tighten the accelerated+device-multiplied trigger, never loosen it, so
  // one notch reliably reads as one switch on Firefox (48px) and Linux
  // Chrome (~53px) instead of paying two notches against the balanced 80px
  // default. Gated on deviceAwareTuning and a 40px floor shared with the
  // formula's own max() so a borderline 30-40px misclassified cluster can't
  // produce a hair-trigger.
  assert.match(app, /const NOTCH_ADAPTIVE_MIN_MAGNITUDE_PX = 40;/);
  assert.match(app, /const NOTCH_ADAPTIVE_TRIGGER_RATIO = 0\.85;/);
  assert.match(
    app,
    /const notchMagnitudePx = settings\.deviceAwareTuning\s*\n\s*\? resolveDetentedNotchMagnitudePx\(wheelSampleWindow\)\s*\n\s*: null;/,
  );
  // Product rule (mutation-checked): device tuning adjusts effective values
  // but must never narrow past explicit user intent. A user on Precise
  // (wheelSensitivity 0.8) or a manually lowered slider asked for more
  // deliberate switching, so the notch-adaptive min() below is only ever
  // reachable at sensitivity >= 1 (Balanced's 1, Fast's 1.35, the default).
  // Worked example: sensitivity 0.8 + a 53px detented notch clears every
  // other condition (deviceAwareTuning on, notch >= 40) but fails this one,
  // so triggerDistance stays resolveWheelTriggerDistance(80, 0.8) = 100 —
  // pinned numerically in tabwheel-core.test.mjs. Deleting the
  // `settings.wheelSensitivity >= 1 &&` clause breaks this exact match.
  assert.match(
    app,
    /const effectiveTriggerDistance =\s*\n\s*settings\.wheelSensitivity >= 1\s*\n\s*&& notchMagnitudePx !== null\s*\n\s*&& notchMagnitudePx >= NOTCH_ADAPTIVE_MIN_MAGNITUDE_PX\s*\n\s*\? Math\.min\(\s*\n\s*triggerDistance,\s*\n\s*Math\.max\(NOTCH_ADAPTIVE_MIN_MAGNITUDE_PX, notchMagnitudePx \* NOTCH_ADAPTIVE_TRIGGER_RATIO\),\s*\n\s*\)\s*\n\s*: triggerDistance;/,
  );
  assert.match(app, /if \(Math\.abs\(wheelAccumulator\) < effectiveTriggerDistance\) return;/);
  assertOrdered(app, [
    "const triggerDistance = acceleratedDistance * deviceAdjustment.triggerDistanceMultiplier;",
    "const effectiveTriggerDistance =",
    "if (Math.abs(wheelAccumulator) < effectiveTriggerDistance) return;",
  ]);
  // The overshoot cap is dead in the shipped product today —
  // normalizeTabWheelSettings force-trues overshootGuard, so the
  // `cycleRan || settings.overshootGuard` branch above always returns first
  // and this line never runs. It is pinned anyway as defense-in-depth: if
  // that guard is ever relaxed, capping to the effective (notch-adaptive)
  // trigger rather than the pre-adaptive one keeps a detented wheel's
  // held-over accumulator sized to its own notch distance.
  assert.match(
    app,
    /wheelAccumulator = Math\.sign\(wheelAccumulator\) \* Math\.min\(\s*\n\s*Math\.abs\(wheelAccumulator\),\s*\n\s*effectiveTriggerDistance,\s*\n\s*\);/,
  );

  // Detented cooldown reduction: a detented notch can't produce a momentum
  // tail, so its cooldown (extraCooldownMs -60 from resolveDeviceTuningAdjustment)
  // sheds down to the same MIN_WHEEL_COOLDOWN_MS floor a configured cooldown
  // already respects, never below it — fast notching stops getting eaten by
  // cooldown without opening a window the momentum guard wasn't built for.
  assert.match(
    app,
    /const effectiveCooldownMs = Math\.max\(MIN_WHEEL_COOLDOWN_MS, settings\.wheelCooldownMs \+ extraCooldownMs\);/,
  );
  assert.match(app, /if \(now - lastWheelCycleAt < effectiveCooldownMs\) return false;/);
  // The guard session inherits the magnitude the committing gesture ended on,
  // and a blocked delta can never seed it because it returns before this.
  assert.match(app, /momentumGuardSession = createMomentumGuardSession\(now, deltaDirection, lastGestureMagnitudePx\);/);
  assertOrdered(app, [
    "wheelAccumulator += wheelDelta;",
    "lastGestureMagnitudePx = Math.abs(wheelDelta);",
  ]);

  // Arrival guard: a session dies with the committing tab's visibility, so the
  // tail lands in a tab with no session and no cooldown. The first delta after
  // a visibility gain seeds a session there instead of being accumulated.
  // The window must stay under a detented wheel's ~40ms cadence, or a clicky
  // wheel pays a swallowed notch on every switch — and every gesture switch is
  // a cross-tab handoff. Only pixel mode (deltaMode 0) seeds: line mode is
  // detented by definition and page mode is a synthetic jump, so neither can
  // be a momentum tail.
  assert.match(app, /const WHEEL_ARRIVAL_GUARD_WINDOW_MS = 32;/);
  assert.match(app, /lastVisibleAtMs = Date\.now\(\);/);
  assert.match(
    app,
    /!momentumGuardSession\s*\n\s*&& event\.deltaMode === 0\s*\n\s*&& now - lastVisibleAtMs <= WHEEL_ARRIVAL_GUARD_WINDOW_MS/,
  );
  assert.match(app, /wheelDelta > 0 \? 1 : -1,\s*\n\s*Math\.abs\(wheelDelta\),/);

  // Every existing reset path drops the guard session with the gesture state.
  assert.match(app, /function resetWheelGestureState\(\): void \{[^}]*lastGestureMagnitudePx = 0;[^}]*momentumGuardSession = null;/);
  assert.match(app, /settings = normalizeTabWheelSettings\(settingsChange\.newValue\);[\s\S]{0,400}resetWheelGestureState\(\);/);
  // Visibility drives both halves: gaining it arms the arrival window, losing
  // it drops the gesture state and the now-useless guard session.
  assert.match(
    app,
    /function visibilityHandler\(\): void \{[\s\S]{0,400}lastVisibleAtMs = Date\.now\(\);[\s\S]{0,300}resetWheelGestureState\(\);/,
  );
});

test("defaults support a predictable first run", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");

  assert.match(contract, /gestureModifier:\s*"alt"/);
  assert.match(contract, /middleClickAction:\s*"openSettings"/);
  assert.match(contract, /cycleScope:\s*"general"/);
  assert.match(contract, /restorePagePosition:\s*true/);
  assert.match(contract, /skipRestrictedPages:\s*true/);
  assert.match(contract, /skipHiddenTabs:\s*true/);
  assert.match(contract, /wrapAround:\s*true/);
  assert.match(contract, /wheelPreset:\s*"balanced"/);
  assert.match(contract, /horizontalWheel:\s*true/);
  assert.match(contract, /allowGesturesInEditableFields:\s*true/);
  assert.match(contract, /overshootGuard:\s*true/);
  assert.match(contract, /deviceAwareTuning:\s*true/);
  assert.match(contract, /showRestrictedBadge:\s*true/);
  assert.doesNotMatch(contract, /leftClickAction|pageScrollSpeedMultiplier|searchUrlTemplate/);
});

test("successful real gestures mark first success locally", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");

  assert.match(domain, /source === "gesture"/);
  assert.match(domain, /recordFirstGestureCycle/);
  assert.match(domain, /firstGestureCycleCompleted:\s*true/);
  assert.match(domain, /saveTabWheelOnboardingState/);
});

test("internal reliability rules are enforced and absent from user-facing controls", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");
  const popup = readText("src/entryPoints/toolbarPopup/toolbarPopup.html");
  const options = readText("src/entryPoints/optionsPage/optionsPage.html");

  for (const key of [
    "allowGesturesInEditableFields",
    "restorePagePosition",
    "skipRestrictedPages",
    "wrapAround",
    "horizontalWheel",
    "overshootGuard",
  ]) {
    assert.match(contract, new RegExp(`${key}: true`));
    assert.doesNotMatch(`${popup}\n${options}`, new RegExp(`id="${key}"`));
  }
  assert.doesNotMatch(`${popup}\n${options}`, /id="direction"|id="invertScroll"|<details/);
});

test("install and pre-v3 update flows open the appropriate onboarding page once", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const onboarding = readText("src/entryPoints/onboarding/onboarding.ts");

  assert.match(domain, /previousMajor < 3/);
  assert.match(domain, /onboarding\/onboarding\.html\?mode=\$\{mode\}/);
  assert.match(onboarding, /mode === "update"/);
  assert.match(onboarding, /focusedReleaseSeen:\s*true/);
  assert.match(onboarding, /demoCompleted:\s*true/);
  assert.match(onboarding, /isTabWheelModifier/);
  assert.match(onboarding, /resolveWheelDirection/);
});

test("onboarding install flow adds a fourth calibration step that samples natural scrolling", () => {
  const html = readText("src/entryPoints/onboarding/onboarding.html");
  const source = readText("src/entryPoints/onboarding/onboarding.ts");

  assert.match(html, /<span class="active" data-progress="1">/);
  assert.match(html, /<span data-progress="4">/);
  assertOrdered(html, [
    'data-step="1"',
    'data-step="2"',
    "Calibrate your scrolling",
    'id="calibrationSampleRegion"',
    'id="skipCalibrationBtn"',
    'id="useSuggestedFeelBtn"',
    'data-step="3"',
    'id="gestureModifier"',
    'data-step="4"',
  ]);
  assert.match(source, /classifyWheelDevice/);
  assert.match(source, /resolveSuggestedPreset/);
  assert.match(source, /addWheelSample\(calibrationSampleWindow/);
  assert.match(source, /applyTabWheelPreset\(settings,\s*suggestedDevicePreset\)/);
  assert.match(source, /showStep\(3\)/);
  assert.match(source, /showStep\(4\)/);
});

test("popup mirrors the full settings order with protected-page fallbacks", () => {
  const html = readText("src/entryPoints/toolbarPopup/toolbarPopup.html");
  const source = readText("src/entryPoints/toolbarPopup/toolbarPopup.ts");

  assert.match(html, /Alt \/ Option \+ wheel down moves through your next tabs\./);
  assert.match(html, /id="statusLabel"/);
  assert.match(html, /id="firstUseNote"/);
  assert.match(html, /id="prevTabBtn"/);
  assert.match(html, /id="nextTabBtn"/);
  assertOrdered(html, [
    'id="gestureModifier"',
    'id="gestureWithShift"',
    'id="middleClickAction"',
    'id="cycleScope"',
    'id="wheelDirection"',
    'id="wheelPreset"',
    'id="wheelSensitivity"',
    'id="wheelCooldownMs"',
    'id="wheelAcceleration"',
    'id="deviceAwareTuning"',
    'id="skipPinnedTabs"',
    'id="skipHiddenTabs"',
    'id="showRestrictedBadge"',
  ]);
  assert.match(html, /<strong>Where it works<\/strong>[\s\S]*<ul>/);
  assert.match(html, /id="refreshTabWheelBtn"[\s\S]*id="resetDefaults"/);
  assert.match(source, /populateMiddleClickActionSelect/);
  assert.match(source, /cycleTabWheel\("prev",\s*"popup"\)/);
  assert.match(source, /cycleTabWheel\("next",\s*"popup"\)/);
  assert.match(source, /refreshCurrentTabWheel/);
  assert.match(source, /resetTabWheelState/);
  assert.match(source, /invertScroll:\s*wheelDirection\.value === "previous"/);
  assert.doesNotMatch(`${html}\n${source}`, /Retry on this page|openOptionsBtn|leftClickAction|pageScroll/i);
});

test("options has one live gesture title and the exact focused control order", () => {
  const html = readText("src/entryPoints/optionsPage/optionsPage.html");
  const source = readText("src/entryPoints/optionsPage/optionsPage.ts");

  assert.match(html, /<h1 id="settingsTitle">Alt \/ Option \+ wheel down moves through your next tabs\.<\/h1>/);
  assertOrdered(html, [
    'id="refreshTabWheelBtn"',
    'id="resetDefaults"',
    'id="gestureModifier"',
    'id="gestureWithShift"',
    'id="middleClickAction"',
    'id="cycleScope"',
    'id="wheelDirection"',
    'id="wheelPreset"',
    'id="wheelSensitivity"',
    'id="wheelCooldownMs"',
    'id="wheelAcceleration"',
    'id="deviceAwareTuning"',
    'id="skipPinnedTabs"',
    'id="skipHiddenTabs"',
    'id="showRestrictedBadge"',
  ]);
  assert.match(html, /<strong>Where it works<\/strong>[\s\S]*<ul>/);
  assert.match(source, /moves through your \$\{direction\} tabs/);
  assert.match(source, /invertScroll:\s*wheelDirection\.value === "previous"/);
  assert.match(source, /middleClickAction:\s*middleClickAction\.value/);
  assert.doesNotMatch(`${html}\n${source}`, /One Gesture|id="restorePagePosition"|<details|leftClickAction|pageScrollSpeedMultiplier|searchUrlTemplate/);
});

test("onboarding gesture choices match the visible settings order", () => {
  const html = readText("src/entryPoints/onboarding/onboarding.html");
  assertOrdered(html, [
    'id="gestureModifier"',
    'id="gestureWithShift"',
    'id="middleClickAction"',
  ]);
  assert.doesNotMatch(html, /id="direction"/);
});

test("build includes onboarding in both browser targets", () => {
  const build = readText("esBuildConfig/build.mjs");
  assert.match(build, /onboarding\/onboarding\.ts/);
  assert.match(build, /onboarding\/onboarding\.html/);
  assert.match(build, /onboarding\/onboarding\.css/);
});
