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
  // momentum tails are the evidence the classifier needs. The guard is
  // consulted before accumulation so a blocked delta is dropped, not banked.
  assertOrdered(app, [
    "if (!event.isTrusted) return;",
    "addWheelSample(",
    "if (!isKeyboardWheelEvent(event)) return;",
    "shouldBlockWheelDelta(",
    "wheelAccumulator += wheelDelta;",
  ]);
  assert.match(app, /suppressPageEvent\(event\);[\s\S]{0,200}shouldBlockWheelDelta\(/);
  assert.match(app, /momentumGuardSession\s*\n\s*&& shouldBlockWheelDelta\(/);

  // Samples stay content-free and local: timing, deltaMode, magnitude only.
  assertOrdered(app, [
    "timeStampMs: now",
    "deltaMode: event.deltaMode",
    "deltaMagnitudePx: Math.abs(wheelDelta)",
  ]);
  assert.doesNotMatch(app, /storage\.local\.set|JSON\.stringify/);

  // Classification is lazy and gated: off means an exact identity adjustment.
  assert.match(app, /if \(!settings\.deviceAwareTuning\) return resolveDeviceTuningAdjustment\("unknown"\);/);
  assert.match(app, /return resolveDeviceTuningAdjustment\(classifyWheelDevice\(wheelSampleWindow\)\);/);

  // Effective values only — stored settings and presets are untouched.
  assert.match(app, /const triggerDistance = acceleratedDistance \* deviceAdjustment\.triggerDistanceMultiplier;/);
  assert.match(app, /settings\.wheelCooldownMs \+ extraCooldownMs/);
  assert.match(app, /momentumGuardSession = createMomentumGuardSession\(now, deltaDirection\);/);

  // Every existing reset path drops the guard session with the gesture state.
  assert.match(app, /function resetWheelGestureState\(\): void \{[^}]*momentumGuardSession = null;/);
  assert.match(app, /settings = normalizeTabWheelSettings\(settingsChange\.newValue\);[\s\S]{0,400}resetWheelGestureState\(\);/);
  assert.match(app, /document\.visibilityState !== "hidden"\) return;[\s\S]{0,200}resetWheelGestureState\(\);/);
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
