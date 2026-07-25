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

test("the momentum guard and the arrival guard are wired into the gesture path", () => {
  const app = readText("src/lib/appInit/appInit.ts");

  // Suppression comes before both guard steps so a swallowed tail cannot
  // scroll the page either, and both run before accumulation so their deltas
  // are dropped, not banked.
  const wheelHandlerSource = app.slice(app.indexOf("function wheelHandler"));
  assertOrdered(wheelHandlerSource, [
    "if (!event.isTrusted) return;",
    "if (!isKeyboardWheelEvent(event)) return;",
    "suppressPageEvent(event);",
    "createMomentumGuardSession(",
    "shouldBlockWheelDelta(",
    "wheelAccumulator += wheelDelta;",
  ]);
  assert.match(app, /momentumGuardSession\s*\n\s*&& shouldBlockWheelDelta\(/);

  // Nothing about the wheel is measured, recorded, or written anywhere: wheel
  // events are handled transiently for the gesture itself and then forgotten.
  assert.doesNotMatch(app, /storage\.local\.set|JSON\.stringify/);

  // One tuning, for every device — the classifier that used to pick between a
  // strict and a lenient variant is gone, so the guard is fed the single
  // constant that lives beside it in the core module.
  assert.match(
    app,
    /shouldBlockWheelDelta\(\s*\n\s*momentumGuardSession,\s*\n\s*wheelDelta,\s*\n\s*now,\s*\n\s*DEFAULT_MOMENTUM_GUARD_TUNING,\s*\n\s*\)/,
  );

  // The whole trigger: configured sensitivity, accelerated by the current
  // burst. No multiplier, no notch adaptation, no per-device narrowing — a
  // preset's feel is exactly what the user picked.
  assert.match(app, /if \(Math\.abs\(wheelAccumulator\) < acceleratedDistance\) return;/);
  assertOrdered(app, [
    "const acceleratedDistance = resolveAcceleratedWheelTriggerDistance(",
    "if (Math.abs(wheelAccumulator) < acceleratedDistance) return;",
  ]);
  assert.doesNotMatch(app, /triggerDistanceMultiplier|notchMagnitudePx|extraCooldownMs/);

  // The overshoot cap is dead in the shipped product today —
  // normalizeTabWheelSettings force-trues overshootGuard, so the
  // `cycleRan || settings.overshootGuard` branch above always returns first
  // and this line never runs. It is pinned anyway as defense-in-depth: if that
  // guard is ever relaxed, an overshoot may carry at most one trigger's worth
  // of distance into the next switch.
  assert.match(
    app,
    /wheelAccumulator = Math\.sign\(wheelAccumulator\) \* Math\.min\(\s*\n\s*Math\.abs\(wheelAccumulator\),\s*\n\s*acceleratedDistance,\s*\n\s*\);/,
  );

  // The configured cooldown, plain: the settings UI already clamps it to
  // MIN_WHEEL_COOLDOWN_MS, so nothing needs re-clamping here.
  assert.match(app, /if \(now - lastWheelCycleAt < settings\.wheelCooldownMs\) return false;/);
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
  // The reset stays scoped to a real settings change: every other key this
  // extension writes lands mid-gesture, and zeroing the accumulator on one
  // would eat the switch the user is scrolling toward.
  const storageHandlerSource = app.slice(
    app.indexOf("function storageChangedHandler("),
    app.indexOf("function messageHandler("),
  );
  assert.ok(storageHandlerSource.length > 0, "storageChangedHandler should be found in source");
  assertOrdered(storageHandlerSource, [
    "const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];",
    "if (!settingsChange) return;",
    "resetWheelGestureState();",
  ]);
  // Visibility drives both halves: gaining it arms the arrival window, losing
  // it drops the gesture state and the now-useless guard session.
  assert.match(
    app,
    /function visibilityHandler\(\): void \{[\s\S]{0,400}lastVisibleAtMs = Date\.now\(\);[\s\S]{0,300}resetWheelGestureState\(\);/,
  );
});

test("the gesture path pre-warms the MV3 worker on a rate limit, off the accumulation path", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const api = readText("src/lib/adapters/runtime/tabWheelApi.ts");
  const contract = readText("src/lib/common/contracts/runtimeMessages.ts");
  const handler = readText("src/lib/backgroundRuntime/handlers/tabWheelMessageHandler.ts");

  // Deliberate contract decision: the pre-warm reuses an existing routed type
  // instead of adding a wake message. TABWHEEL_CONTENT_READY's handler is the
  // only one in the router that returns without awaiting anything (its MRU
  // touch is detached, and a no-op for an already-current tab), and what it
  // asserts is literally true when a live content script sends it mid-gesture.
  // Adding a wake type would widen the runtime contract for nothing, so this
  // pin is where that choice gets revisited.
  assert.doesNotMatch(`${contract}\n${api}`, /TABWHEEL_WAKE|TABWHEEL_PREWARM/);
  assert.match(
    handler,
    /case "TABWHEEL_CONTENT_READY":\s*\n\s*return domain\.markContentScriptReady\(sender\.tab\);/,
  );
  assert.match(
    api,
    /export function notifyTabWheelContentReady\(\)[\s\S]{0,220}type: "TABWHEEL_CONTENT_READY"/,
  );

  // One ping per 15s covers MV3's ~30s idle shutdown without turning every
  // gesture event into a message.
  assert.match(app, /const WORKER_PREWARM_INTERVAL_MS = 15000;/);

  const wheelHandlerSource = app.slice(
    app.indexOf("function wheelHandler"),
    app.indexOf("function resetWheelGestureState"),
  );
  assert.ok(wheelHandlerSource.length > 0, "wheelHandler should be found in source");

  // Rate limited, top-frame only (only the top frame registers the runtime
  // listener, so only the top frame can answer the ping that "ready"
  // promises), and fire-and-forget: a slow or failed wake must never delay,
  // block, or alter the gesture it is warming.
  assert.match(
    wheelHandlerSource,
    /if \(isTopFrameContext && now - lastWorkerPrewarmAt >= WORKER_PREWARM_INTERVAL_MS\) \{\s*\n\s*lastWorkerPrewarmAt = now;\s*\n\s*void notifyTabWheelContentReady\(\)\.catch\(\(\) => \{\}\);\s*\n\s*\}/,
  );
  assert.doesNotMatch(wheelHandlerSource, /await notifyTabWheelContentReady/);

  // Bookended on both sides, because the position encodes two decisions.
  // Before: the chord is recognized and the event already suppressed, so plain
  // scrolling never wakes the worker. After: both momentum-guard steps still
  // follow, which locks in the deliberate choice that a delta the guard goes
  // on to drop *still* warms the worker — the wake is about the user's hand
  // being on the wheel, not about whether this particular delta commits.
  assertOrdered(wheelHandlerSource, [
    "if (!isKeyboardWheelEvent(event)) return;",
    "suppressPageEvent(event);",
    "void notifyTabWheelContentReady()",
    "createMomentumGuardSession(",
    "shouldBlockWheelDelta(",
    "wheelAccumulator += wheelDelta;",
  ]);
});

test("a completed cycle pre-probes its neighbors off the hot path without waking discarded tabs", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const cycleSource = domain.slice(
    domain.indexOf("async function cycleUnlocked("),
    domain.indexOf("async function cycle("),
  );
  assert.ok(cycleSource.length > 0, "cycleUnlocked should be found in source");

  // Detached with `void` after the switch already landed: the serialized
  // window queue chains the next gesture on the promise cycleUnlocked returns,
  // so probes must never be part of it. Awaiting here would put up to four
  // 320ms probes in front of both this cycle's response and the next switch.
  assertOrdered(cycleSource, [
    "const didActivate = await activateTab(targetTab, { restoreScrollAsync: true });",
    "void warmNeighborReadiness(targetTab, candidateTabs, settings).catch(() => {});",
    "return { ok: true, tabId: targetTab.id };",
  ]);
  assert.doesNotMatch(cycleSource, /await warmNeighborReadiness/);

  const warmSource = domain.slice(
    domain.indexOf("function collectNeighborCandidateTabs("),
    domain.indexOf("async function activateTab("),
  );
  assert.ok(warmSource.length > 0, "the neighbor pre-probe helpers should be found in source");

  // Candidates come from the list this cycle already built, walked outward
  // through the cycle's own target resolution so scope (strip vs MRU) and
  // wrap-around semantics are inherited rather than re-derived.
  assert.match(domain, /const NEIGHBOR_PREPROBE_DEPTH = 2;/);
  assert.match(warmSource, /for \(const direction of \["next", "prev"\] as const\)/);
  assert.match(warmSource, /step < NEIGHBOR_PREPROBE_DEPTH/);
  assert.match(
    warmSource,
    /resolveCycleTargetTab\(cursorTab, candidateTabs, direction, settings\)/,
  );
  assert.doesNotMatch(warmSource, /getWindowTabs|browser\.tabs\.query|getGestureEligibleTabs/);

  // Hard rule: probing injects a content script, which would wake a tab the
  // browser deliberately unloaded. Speculation never gets to spend the user's
  // memory on a tab they may never switch to.
  assert.match(warmSource, /if \(tab\.id == null \|\| tab\.discarded === true\) return false;/);
  // Already-answered tabs are skipped in both directions of the cache.
  assert.match(warmSource, /if \(isContentScriptKnownUnavailable\(tab\)\) return false;/);
  assert.match(warmSource, /return contentScriptReadyUrlsByTabId\.get\(tab\.id\) !== url;/);
  // Only the restricted-page skip path probes during a cycle, so with it off
  // pre-probing would inject scripts that buy the next gesture nothing.
  assert.match(warmSource, /if \(!settings\.skipRestrictedPages\) return;/);

  // Sequential by construction: a cold window must not turn one switch into
  // four simultaneous script injections.
  assert.doesNotMatch(warmSource, /Promise\.all/);

  // Both suppression sets are load-bearing and trivially deletable by
  // accident: one stops two live chains probing the same tab, the other stops
  // a failed speculative probe being retried immediately by the next chain.
  assert.match(domain, /const neighborWarmupTabIds = new Set<number>\(\);/);
  assert.match(domain, /const neighborPreprobedUntilByTabId = new Map<number, number>\(\);/);
  assert.match(warmSource, /if \(neighborWarmupTabIds\.has\(tab\.id\)\) return false;/);
  assert.match(warmSource, /neighborWarmupTabIds\.add\(neighborTabId\);/);
  assert.match(warmSource, /neighborWarmupTabIds\.delete\(neighborTabId\);/);
});

test("a speculative probe can never change what the next cycle is allowed to reach", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const warmSource = domain.slice(
    domain.indexOf("function collectNeighborCandidateTabs("),
    domain.indexOf("async function activateTab("),
  );
  assert.ok(warmSource.length > 0, "the neighbor pre-probe helpers should be found in source");

  // The invariant: pre-probing may only ever make the next cycle faster, never
  // narrower. markContentScriptUnavailable feeds getGestureEligibleTabs, so
  // writing it from a speculative probe would let a probe *remove* a tab from
  // the user's cycle. That is unsound here in a way it is not on the hot path:
  // probing injects, injection is itself what wakes a frozen or throttled tab,
  // and so a 320ms timeout on a speculative probe is not evidence the tab is
  // unusable — it is frequently a tab the probe just made usable. Only the hot
  // path, which is resolving a switch the user actually asked for, may record.
  assert.match(
    domain,
    /async function ensurePageGestureAvailable\(\s*\n\s*tab: Tabs\.Tab,\s*\n\s*\{ recordFailure = true \}: EnsurePageGestureProbeOptions = \{\},\s*\n\s*\): Promise<boolean> \{/,
  );
  // Every negative-cache write inside the probe must sit behind the flag.
  // Counting rather than matching one occurrence is deliberate: the probe has
  // two failure exits (restricted URL, and the 320ms timeout), and gating only
  // one of them re-arms the bug for speculative callers while still matching
  // any single-site assertion.
  const probeSource = domain.slice(
    domain.indexOf("async function ensurePageGestureAvailable("),
    domain.indexOf("async function restoreScroll("),
  );
  assert.ok(probeSource.length > 0, "ensurePageGestureAvailable should be found in source");
  const negativeCacheWrites = probeSource.match(/markContentScriptUnavailable/g) ?? [];
  const gatedNegativeCacheWrites = probeSource
    .match(/if \(recordFailure\) markContentScriptUnavailable\(tab\);/g) ?? [];
  assert.ok(negativeCacheWrites.length > 0, "the probe should still record failures for the hot path");
  assert.equal(
    gatedNegativeCacheWrites.length,
    negativeCacheWrites.length,
    "every negative-cache write in ensurePageGestureAvailable must be gated on recordFailure",
  );
  assert.match(
    warmSource,
    /await ensurePageGestureAvailable\(neighborTab, \{ recordFailure: false \}\)/,
  );
  assert.doesNotMatch(warmSource, /markContentScriptUnavailable/);
  // The hot path keeps recording: that cache is exactly what lets the next
  // gesture skip a genuinely dead tab cheaply instead of re-paying 320ms.
  assert.match(
    domain,
    /if \(!settings\.skipRestrictedPages \|\| await ensurePageGestureAvailable\(targetTab\)\) return targetTab;/,
  );

  // Dropping the negative marking must not buy the invariant with a re-probe
  // storm, so a failed speculative probe is remembered locally for the same
  // window the negative cache used to cover — without touching eligibility.
  assert.match(
    domain,
    /const NEIGHBOR_PREPROBE_RETRY_COOLDOWN_MS = CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS;/,
  );
  assert.match(warmSource, /if \(isNeighborRecentlyPreprobed\(tab\.id\)\) return false;/);
  assert.match(
    warmSource,
    /neighborPreprobedUntilByTabId\.set\(\s*\n\s*neighborTabId,\s*\n\s*Date\.now\(\) \+ NEIGHBOR_PREPROBE_RETRY_COOLDOWN_MS,\s*\n\s*\);/,
  );

  // Fan-out guard: per-chain sequentiality is not enough. At the detented
  // 100ms cooldown a burst can leave ~10 chains alive on a cold window, which
  // collectively is the injection stampede sequential probing exists to
  // prevent. The newest neighborhood is the most predictive, so a newer chain
  // supersedes the older ones rather than being dropped in favor of them.
  assert.match(warmSource, /const generation = beginNeighborWarmupGeneration\(windowId\);/);
  assert.match(warmSource, /if \(!isNeighborWarmupCurrent\(windowId, generation\)\) return;/);
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

test("the onboarding calibration panel is inert and every step is still reachable", () => {
  const html = readText("src/entryPoints/onboarding/onboarding.html");
  const source = readText("src/entryPoints/onboarding/onboarding.ts");

  // Transitional state: the device classifier the step-2 panel fed is gone, so
  // its sampling, classification, and suggested-preset wiring were removed
  // with it. The markup, CSS, and step renumbering come out next, so the panel
  // is still rendered — Skip is the one control that still does anything, and
  // it is what keeps the flow traversable in the meantime.
  assert.match(html, /<span class="active" data-progress="1">/);
  assert.match(html, /<span data-progress="4">/);
  assertOrdered(html, [
    'data-step="1"',
    'data-step="2"',
    'id="calibrationSampleRegion"',
    'id="skipCalibrationBtn"',
    'data-step="3"',
    'id="gestureModifier"',
    'data-step="4"',
  ]);
  assert.doesNotMatch(source, /classifyWheelDevice|resolveSuggestedPreset|addWheelSample|SampleWindow/);
  assert.match(
    source,
    /byId<HTMLButtonElement>\("skipCalibrationBtn"\)\.addEventListener\("click", \(\) => showStep\(3\)\);/,
  );
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
