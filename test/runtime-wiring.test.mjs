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

test("runtime contract exposes wheel and focused click actions", () => {
  const contract = readText("src/lib/common/contracts/runtimeMessages.ts");
  const handler = readText("src/lib/backgroundRuntime/handlers/tabWheelMessageHandler.ts");
  const api = readText("src/lib/adapters/runtime/tabWheelApi.ts");

  assert.match(contract, /TABWHEEL_CYCLE/);
  assert.match(contract, /source:\s*TabWheelCycleSource/);
  assert.match(contract, /TABWHEEL_SAVE_SCROLL_POSITION/);
  assert.match(contract, /TABWHEEL_OPEN_OPTIONS/);
  assert.match(
    handler,
    /domain\.cycle\(message\.direction,\s*message\.source,\s*sender\.tab,\s*message\.windowId\)/,
  );
  assert.match(handler, /browser\.runtime\.openOptionsPage\(\)/);
  assert.match(handler, /return \{ ok: true \}/);
  assert.match(handler, /return \{ ok: false,\s*reason: "Settings unavailable" \}/);
  assert.match(api, /source:\s*TabWheelCycleSource/);
  assert.match(api, /openTabWheelOptions/);
  for (const action of [
    "TABWHEEL_OPEN_NATIVE_NEW_TAB",
    "TABWHEEL_ACTIVATE_MOST_RECENT_TAB",
    "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT",
    "TABWHEEL_DUPLICATE_TAB",
    "TABWHEEL_MOVE_CURRENT_TAB",
  ]) {
    assert.match(contract, new RegExp(action));
    assert.match(api, new RegExp(action));
  }
  assert.match(
    handler,
    /domain\.moveCurrentTab\(message\.direction,\s*sender\.tab,\s*message\.gestureId\)/,
  );
  assert.match(contract, /TABWHEEL_BEGIN_TAB_DRAG/);
  assert.match(contract, /TABWHEEL_END_TAB_DRAG/);
  assert.match(api, /beginTabWheelDragGesture/);
  assert.match(api, /endTabWheelDragGesture/);
  assert.match(handler, /TABWHEEL_BEGIN_TAB_DRAG/);
  assert.match(handler, /TABWHEEL_END_TAB_DRAG/);
  assert.match(
    api,
    /moveCurrentTabWheelTab\(\s*direction:\s*TabWheelMoveDirection/,
  );
  assert.doesNotMatch(`${contract}\n${api}`, /SEARCH_HISTORY|SET_CYCLE_SCOPE/);
});

test("content script claims configured click actions and leaves Off unclaimed", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const mouseCore = readText("src/lib/core/tabWheel/mouseGestureCore.ts");

  assert.match(app, /isTabWheelModifier\(event,\s*settings\.gestureModifier,\s*settings\.gestureWithShift\)/);
  assert.match(app, /TAB_DRAG_KEEPALIVE_MS/);
  assert.match(app, /window\.addEventListener\("wheel",\s*wheelHandler,\s*\{\s*passive:\s*false,\s*capture:\s*true\s*\}\)/);
  assert.match(app, /cycleTabWheel\(direction,\s*"gesture"\)/);
  assert.match(app, /buildMouseGesturePolicies\(settings\)/);
  assert.match(app, /window\.addEventListener\("pointerdown",\s*mouseGestureHandler,\s*true\)/);
  assert.match(app, /window\.addEventListener\("pointermove",\s*tabDragPointerMoveHandler/);
  assert.match(app, /window\.addEventListener\("pointercancel",\s*tabDragPointerCancelHandler/);
  assert.match(app, /window\.addEventListener\("lostpointercapture",\s*tabDragPointerCaptureLostHandler/);
  assert.match(app, /window\.addEventListener\("blur",\s*cancelUnreleasedTabDragGesture/);
  assert.match(
    app,
    /function cancelUnreleasedTabDragGesture\(\)[\s\S]*if \(!tabDragGesture\?\.released\) cancelTabDragGesture\(\)/,
  );
  assert.match(app, /window\.addEventListener\("click",\s*mouseGestureHandler,\s*true\)/);
  assert.match(app, /window\.addEventListener\("auxclick",\s*mouseGestureHandler,\s*true\)/);
  assert.match(app, /window\.addEventListener\("contextmenu",\s*mouseGestureHandler,\s*true\)/);
  assert.match(app, /runActionWithStatus\(openTabWheelOptions,\s*"Settings unavailable"\)/);
  assert.match(app, /case "nativeNewTab":/);
  assert.match(app, /policy\.interaction === "drag"/);
  assert.match(app, /advanceTabDragState\(/);
  assert.match(app, /coalesceTabDragDirections\(/);
  assert.match(app, /reconcileTabDragBoundaryDirections\(/);
  assert.match(app, /clearTabDragBoundary\(/);
  assert.match(app, /claimTabDragPressWhileDraining\(/);
  assert.match(
    app,
    /const drainingPolicy = resolveMousePolicy\(event\);[\s\S]*drainingPolicy\?\.interaction === "drag"/,
  );
  assert.match(app, /isTabDragButtonPressed\(session\.button,\s*event\.buttons\)/);
  assert.match(app, /__tabWheelMouseClaim/);
  assert.match(app, /handleCarriedMouseClaim\(/);
  assert.match(app, /rememberMouseClaimForReinjection\(/);
  assert.match(app, /cancelTabDragGesture\(true\)/);
  assert.match(app, /if \(session\.completionReceived\) return/);
  assert.match(app, /isMouseClaimReleaseEvent\(/);
  assert.match(
    app,
    /if \(isMouseClaimReleaseEvent\(event\) \|\| isMouseClaimCompletionEvent\(claim\.button,\s*event\)\)/,
  );
  assert.match(
    app,
    /if \(session\.released\) scheduleTabDragFinishTimer\(session\)/,
  );
  assert.match(
    app,
    /if \(!tabDragGesture\?\.released\) cancelTabDragGesture\(\)/,
  );
  assert.match(app, /reserveTabDragQueue\(\)/);
  assert.match(app, /waitForPreviousDrag/);
  assert.match(app, /moveCurrentTabWheelTab\(direction,\s*session\.gestureId\)/);
  assert.match(app, /markTabDragBoundary\(/);
  assert.match(mouseCore, /if \(action === "none"\) continue/);
  assert.match(
    app,
    /const policy = resolveMousePolicy\(event\);\s*\n\s*if \(!policy\) return;\s*\n\s*if \(policy\.interaction === "drag"\)/,
  );
  assert.match(
    app,
    /suppressPageEvent\(event\);\s*\n\s*mouseGestureSession = createMouseGestureSession\(policy,\s*Date\.now\(\)\)/,
  );
  assert.doesNotMatch(app, /pageScrollSpeedMultiplier|pageScrollViewportCapRatio|scalePageScroll/);
});

test("the momentum guard and the arrival guard are wired into the gesture path", () => {
  const app = readText("src/lib/appInit/appInit.ts");

  // The chord check leads, and it subsumes the isTrusted test, so a plain
  // scroll — the overwhelming majority of wheel events on any page — exits
  // before normalization or a clock read. Suppression then comes before both
  // guard steps so a swallowed tail cannot scroll the page either, and both
  // run before accumulation so their deltas are dropped, not banked.
  const wheelHandlerSource = app.slice(app.indexOf("function wheelHandler"));
  assertOrdered(wheelHandlerSource, [
    "if (!isKeyboardWheelEvent(event)) return;",
    "const wheelDelta = normalizeWheelDelta(",
    "if (wheelDelta === 0) return;",
    "const now = Date.now();",
    "suppressPageEvent(event);",
    "createMomentumGuardSession(",
    "shouldBlockWheelDelta(",
    "wheelAccumulator += wheelDelta;",
  ]);
  // isTrusted is checked once, inside the chord predicate — not again here.
  assert.match(app, /function isKeyboardWheelEvent\(event: WheelEvent\): boolean \{[\s\S]{0,200}event\.isTrusted/);
  assert.doesNotMatch(wheelHandlerSource, /if \(!event\.isTrusted\) return;/);
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
  // the user's cycle. The probe classifies tri-state: "slow" — readiness
  // lagging the budget, including the budget expiring — is never recorded at
  // all, because a successful injection proves the page can host the script.
  // Only provable rejection may record, and only for the hot path, which is
  // resolving a switch the user actually asked for.
  assert.match(
    domain,
    /async function resolvePageGestureReadiness\(\s*\n\s*tab: Tabs\.Tab,\s*\n\s*\{ recordFailure = true \}: EnsurePageGestureProbeOptions = \{\},\s*\n\s*\): Promise<"ready" \| "slow" \| "unavailable"> \{/,
  );
  // Every negative-cache write inside the probe must sit behind the flag.
  // Counting rather than matching one occurrence is deliberate: the probe has
  // two rejection exits (restricted URL, and refused injection), and gating
  // only one of them re-arms the bug for speculative callers while still
  // matching any single-site assertion.
  const probeSource = domain.slice(
    domain.indexOf("async function resolvePageGestureReadiness("),
    domain.indexOf("async function restoreScroll("),
  );
  assert.ok(probeSource.length > 0, "resolvePageGestureReadiness should be found in source");
  const negativeCacheWrites = probeSource.match(/markContentScriptUnavailable/g) ?? [];
  const gatedNegativeCacheWrites = probeSource
    .match(/if \((?:readiness === "unavailable" && )?recordFailure\) markContentScriptUnavailable\(tab\);/g) ?? [];
  assert.ok(negativeCacheWrites.length > 0, "the probe should still record rejections for the hot path");
  assert.equal(
    gatedNegativeCacheWrites.length,
    negativeCacheWrites.length,
    "every negative-cache write in resolvePageGestureReadiness must be gated on recordFailure",
  );
  assert.match(
    warmSource,
    /await ensurePageGestureAvailable\(neighborTab, \{ recordFailure: false \}\)/,
  );
  assert.doesNotMatch(warmSource, /markContentScriptUnavailable/);
  // The hot path keeps recording rejections: that cache is exactly what lets
  // the next gesture skip a genuinely refused tab cheaply instead of
  // re-paying a probe. But only "unavailable" removes a stop from the strip —
  // "slow" lands, so the strip the user sees is the strip the wheel walks.
  assert.match(
    domain,
    /if \(!settings\.skipRestrictedPages\) return targetTab;\s*\n\s*if \(await resolvePageGestureReadiness\(targetTab\) !== "unavailable"\) return targetTab;/,
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
  const clickCore = readText("src/lib/core/tabWheel/mouseGestureCore.ts");
  assert.match(clickCore, /leftClickAction:\s*"nativeNewTab"/);
  assert.match(clickCore, /middleClickAction:\s*"dragCurrentTab"/);
  assert.match(clickCore, /rightClickAction:\s*"closeToRecent"/);
  assert.match(contract, /restorePagePosition:\s*true/);
  assert.match(contract, /skipRestrictedPages:\s*true/);
  assert.match(contract, /skipHiddenTabs:\s*true/);
  assert.match(contract, /wrapAround:\s*true/);
  assert.match(contract, /cycleWithinTabGroup:\s*false/);
  assert.match(contract, /wheelPreset:\s*"balanced"/);
  assert.match(contract, /horizontalWheel:\s*true/);
  assert.match(contract, /allowGesturesInEditableFields:\s*true/);
  assert.match(contract, /overshootGuard:\s*true/);
  assert.match(contract, /showRestrictedBadge:\s*true/);
  assert.doesNotMatch(contract, /cycleScope|pageScrollSpeedMultiplier|searchUrlTemplate/);
});

test("successful real gestures mark first success locally", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");

  assert.match(domain, /source === "gesture"/);
  assert.match(domain, /recordFirstGestureCycle/);
  assert.match(domain, /firstGestureCycleCompleted:\s*true/);
  assert.match(domain, /saveTabWheelOnboardingState/);
});

test("click actions use adjacent native tabs and exact same-window recent history", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const newTabSource = domain.slice(
    domain.indexOf("async function openNativeNewTab("),
    domain.indexOf("async function activateMostRecentTab("),
  );
  assert.match(newTabSource, /browser\.tabs\.create\(\{/);
  assert.match(newTabSource, /active:\s*true/);
  assert.match(newTabSource, /index:\s*getTabIndex\(activeTab\) \+ 1/);
  assert.match(newTabSource, /openerTabId:\s*activeTab\.id/);
  assert.doesNotMatch(newTabSource, /\burl:/);

  const recentSource = domain.slice(
    domain.indexOf("function getRecentCandidateTabs("),
    domain.indexOf("async function refreshCurrentTab("),
  );
  assert.match(recentSource, /recentTabIdsByWindowId\[windowKey\(windowId\)\]/);
  assert.match(recentSource, /\.filter\(\(tabId\) => tabId !== activeTabId\)/);
  assert.doesNotMatch(recentSource, /getGestureEligibleTabs|skipPinnedTabs|skipHiddenTabs|cycleWithinTabGroup/);

  const closeSource = domain.slice(
    domain.indexOf("async function closeCurrentTabAndActivateRecent("),
    domain.indexOf("async function duplicateTab("),
  );
  assertOrdered(closeSource, [
    "await activateTab(targetTab, { restoreScrollAsync: true })",
    "await browser.tabs.remove(activeTab.id)",
  ]);

  const duplicateSource = domain.slice(
    domain.indexOf("async function duplicateTab("),
    domain.indexOf("async function refreshCurrentTab("),
  );
  assert.match(duplicateSource, /browser\.tabs\.duplicate\(activeTab\.id\)/);
  assert.match(duplicateSource, /browser\.tabs\.update\(duplicatedTab\.id, \{ active: true \}\)/);
});

test("tab dragging moves the initiating active tab within structural boundaries", () => {
  const types = readText("src/types.d.ts");
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const moveSource = domain.slice(
    domain.indexOf("async function moveCurrentTabUnlocked("),
    domain.indexOf("async function refreshCurrentTab("),
  );

  assert.match(types, /type TabWheelMoveDirection = "left" \| "right"/);
  assert.match(types, /interface TabWheelMoveResult extends TabWheelActionResult/);
  assert.match(types, /moved:\s*boolean/);
  assert.match(domain, /tabDragSessionsById/);
  assert.match(domain, /releaseTabDragSession\(/);
  assert.match(
    domain,
    /browser\.tabs\.onDetached\.addListener\(\(tabId[\s\S]*releaseTabDragSession\(session\.gestureId\)/,
  );
  assert.match(moveSource, /gestureId/);
  assert.match(moveSource, /browser\.tabs\.get\(tab\.id\)/);
  assert.match(moveSource, /activeTab\.active !== true/);
  assert.match(moveSource, /getWindowTabs\(activeTab\.windowId\)/);
  assert.match(
    moveSource,
    /resolveTabDragTargetIndex\(activeTab,\s*tabs,\s*direction\)/,
  );
  assert.match(moveSource, /return \{ ok: true,\s*moved: false/);
  assert.match(
    moveSource,
    /browser\.tabs\s*\n\s*\.move\(activeTab\.id,\s*\{\s*index: targetIndex\s*\}\)/,
  );
  assert.match(moveSource, /invalidateWindowTabsCache\(activeTab\.windowId\)/);
});

test("cycling within the active tab's group filters eligibility from the active tab's groupId", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");

  // Ungrouped tabs (-1, or undefined where tabGroups is unsupported) all
  // normalize to the same id, so a browser with no group support only ever
  // has one implicit group and the filter below degrades to a no-op there.
  assert.match(domain, /function normalizeTabGroupId\(groupId: number \| undefined\): number \{\s*\n\s*return groupId \?\? -1;\s*\n\s*\}/);

  const eligibleTabsSource = domain.slice(
    domain.indexOf("function getEligibleTabs("),
    domain.indexOf("function hasSameNumberList("),
  );
  assert.ok(eligibleTabsSource.length > 0, "getEligibleTabs should be found in source");
  // Required, not optional: an omitted argument must not be able to silently
  // narrow eligibility to ungrouped-only tabs. null is the explicit "no
  // active tab to compare against" signal, and it must skip the predicate
  // rather than being coerced into a group id.
  assert.match(eligibleTabsSource, /activeTabGroupId:\s*number \| null,/);
  assert.doesNotMatch(eligibleTabsSource, /activeTabGroupId\?:/);
  // Ordered last among the eligibility predicates: the cheaper, more commonly
  // active filters (pinned/hidden/restricted) short-circuit first, and the
  // group check only runs when the setting is on and there is a subject to
  // compare against.
  assertOrdered(eligibleTabsSource, [
    "!settings.skipPinnedTabs",
    "!settings.skipHiddenTabs",
    "!settings.skipRestrictedPages",
    "!settings.cycleWithinTabGroup",
    "activeTabGroupId == null",
    "normalizeTabGroupId(tab.groupId) === activeTabGroupId",
  ]);

  // getGestureEligibleTabs is the sole choke point that turns an active tab
  // into the groupId the filter above compares against; no active tab means
  // no subject, so it passes null (skip the predicate), not a made-up id.
  const gestureEligibleSource = domain.slice(
    domain.indexOf("async function getGestureEligibleTabs("),
    domain.indexOf("function beginScrollRestore("),
  );
  assert.ok(gestureEligibleSource.length > 0, "getGestureEligibleTabs should be found in source");
  assert.match(gestureEligibleSource, /activeTab:\s*Tabs\.Tab \| null,/);
  assert.match(
    gestureEligibleSource,
    /activeTab \? activeTab\.groupId \?\? -1 : null,/,
  );

  // Both callers already resolve the active tab before asking for eligible
  // tabs, so wiring it through is passing an existing value, not resolving a
  // new one.
  assert.match(
    domain,
    /const eligibleTabs = await getGestureEligibleTabs\(tabs, settings, resolvedWindowId, activeTab\);/,
  );
  assert.match(
    domain,
    /const eligibleTabs = await getGestureEligibleTabs\(tabs, settings, activeTab\.windowId, activeTab\);/,
  );
});

test("wrap-around and the group filter compose: both act on the same candidate list", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const cycleSource = domain.slice(
    domain.indexOf("async function cycleUnlocked("),
    domain.indexOf("async function cycle("),
  );
  assert.ok(cycleSource.length > 0, "cycleUnlocked should be found in source");

  // candidateTabs is derived from eligibleTabs (already group-filtered when
  // the setting is on) before either wrap-around resolver or the neighbor
  // pre-probe ever sees it — neither needs its own group awareness.
  assertOrdered(cycleSource, [
    "const eligibleTabs = await getGestureEligibleTabs(tabs, settings, activeTab.windowId, activeTab);",
    "const candidateTabs = eligibleTabs;",
    "resolveAvailableCycleTargetTab(activeTab, candidateTabs, direction, settings)",
    "warmNeighborReadiness(targetTab, candidateTabs, settings)",
  ]);
  assert.match(
    domain,
    /resolveStripTargetTab\(activeTab, candidateTabs, direction, settings\.wrapAround\)/,
  );
  assert.doesNotMatch(domain, /cycleScope|resolveMruCycle|MruCycleSession/);
});

test("reset to defaults clears preferences and position state, and nothing else", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const resetSource = domain.slice(
    domain.indexOf("async function resetState("),
    domain.indexOf("async function activateExistingContentScripts("),
  );
  assert.ok(resetSource.length > 0, "resetState should be found in source");

  // Exactly three keys, because "reset to defaults" is a promise about the
  // user's preferences and the position state derived from their browsing —
  // widening this list silently deletes something they never asked to lose.
  assert.match(
    resetSource,
    /await browser\.storage\.local\.remove\(\[\s*\n\s*TABWHEEL_STORAGE_KEYS\.settings,\s*\n\s*TABWHEEL_STORAGE_KEYS\.recentTabs,\s*\n\s*TABWHEEL_STORAGE_KEYS\.scrollMemory,\s*\n\s*\]\)/,
  );
  // The worker keeps both of those maps in memory, so clearing storage alone
  // would leave a live worker serving state it just deleted.
  assert.match(resetSource, /recentTabIdsByWindowId = \{\};/);
  assert.match(resetSource, /scrollMemoryByTabId = \{\};/);
  assert.match(resetSource, /updateSettingsCache\(undefined\);/);
  // Onboarding completion is deliberately NOT cleared: restoring settings must
  // not reopen the first-run coach on a user who has already finished it.
  assert.doesNotMatch(resetSource, /onboarding/i);
});

test("internal reliability rules are enforced and absent from user-facing controls", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");
  const popup = readText("src/entryPoints/toolbarPopup/toolbarPopup.html");
  const options = readText("src/entryPoints/optionsPage/optionsPage.html");

  for (const key of [
    "allowGesturesInEditableFields",
    "restorePagePosition",
    "skipRestrictedPages",
    "horizontalWheel",
    "overshootGuard",
    "showRestrictedBadge",
  ]) {
    assert.match(contract, new RegExp(`${key}: true`));
    assert.doesNotMatch(`${popup}\n${options}`, new RegExp(`id="${key}"`));
  }
  assert.doesNotMatch(`${popup}\n${options}`, /id="direction"|id="invertScroll"|<details/);
});

// wrapAround graduated from a forced internal rule (3.1.0) to a normal
// user setting: it now normalizes like skipHiddenTabs and has controls
// in both mirrors. This pins that it stayed graduated.
test("wrap-around is a normal user setting, not an internal reliability rule", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");
  const popup = readText("src/entryPoints/toolbarPopup/toolbarPopup.html");
  const options = readText("src/entryPoints/optionsPage/optionsPage.html");
  const normalizerSource = contract.slice(
    contract.indexOf("export function normalizeTabWheelSettings("),
    contract.indexOf("export function normalizeTabWheelOnboardingState("),
  );
  assert.ok(normalizerSource.length > 0, "normalizeTabWheelSettings should be found in source");

  assert.match(
    normalizerSource,
    /wrapAround:\s*normalizeEnabledFlag\(settings\.wrapAround,\s*DEFAULT_TABWHEEL_SETTINGS\.wrapAround\)/,
  );
  // Force-true would silently ignore whatever the mirrors write; it must be
  // gone from the normalizer now that the control is user-facing.
  assert.doesNotMatch(normalizerSource, /wrapAround:\s*true,/);
  assert.match(popup, /id="wrapAround"/);
  assert.match(options, /id="wrapAround"/);
});

test("install and pre-v4 update flows open the same complete onboarding sequence", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const onboarding = readText("src/entryPoints/onboarding/onboarding.ts");

  assert.match(domain, /previousMajor < 4/);
  assert.match(domain, /runtime\.getURL\("onboarding\/onboarding\.html"\)/);
  assert.doesNotMatch(onboarding, /mode === "update"/);
  assert.match(onboarding, /clickActionsReleaseSeen:\s*true/);
  assert.match(onboarding, /demoCompleted:\s*true/);
  assert.match(onboarding, /isTabWheelModifier/);
  assert.match(onboarding, /resolveWheelDirection/);
});

test("wheel and mouse actions use separate onboarding flows", () => {
  const html = readText("src/entryPoints/onboarding/onboarding.html");
  const source = readText("src/entryPoints/onboarding/onboarding.ts");

  // The device classifier and calibration panel are gone. Mouse onboarding
  // remains a separate container inserted between the demo and wheel settings.
  assert.match(html, /id="wheelFlow"/);
  assert.match(html, /id="mouseFlow"[\s\S]*hidden/);
  assert.match(html, /<span class="active" data-progress="1">/);
  assertOrdered(html, [
    'id="wheelFlow"',
    'data-wheel-step="1"',
    'data-wheel-step="2"',
    'id="gestureModifier"',
    'data-wheel-step="3"',
    'id="mouseFlow"',
    'data-mouse-step="1"',
    'id="clickGestureDemo"',
  ]);
  assert.doesNotMatch(source, /classifyWheelDevice|resolveSuggestedPreset|addWheelSample|SampleWindow/);
  assert.doesNotMatch(
    `${html}\n${source}`,
    /calibrat|skipCalibrationBtn|useSuggestedFeelBtn|calibrationResult|calibrationSampleRegion/i,
  );
  assert.match(source, /function showWheelStep/);
  assert.match(source, /function showMouseStep/);
  assert.match(source, /function openMouseFlow/);
  assert.match(source, /continueDemoBtn\.addEventListener\("click", openMouseFlow\)/);
  assert.match(source, /function continueToWheelSettings/);
  assert.match(source, /createTabDragState/);
  assert.match(source, /advanceTabDragState/);
  assert.match(source, /function clickDemoDragMoveHandler/);
  assert.match(source, /moveSimulatedCurrentTab/);
  assert.match(source, /saveChoicesBtn"\)\.addEventListener\("click", \(\) => \{\s*continueToWheelSettings\(\)/);
  assert.match(source, /renderCombo\(\);\s*showWheelStep\(3\)/);
  assert.match(source, /wheelFlow\.hidden = true[\s\S]*mouseFlow\.hidden = false/);
  assert.match(html, /One modifier for the wheel and mouse clicks\./);
  assert.match(html, /id="settingsWheelCombo"/);
  assert.match(html, /Mouse click actions[\s\S]*id="leftClickAction"/);
  assert.match(html, /id="middleClickAction"/);
  assert.match(html, /id="rightClickAction"/);
  assert.match(source, /gestureWithShift:\s*gestureWithShift\.checked,[\s\S]*leftClickAction:\s*leftClickAction\.value/);
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
    'id="leftClickAction"',
    'id="middleClickAction"',
    'id="rightClickAction"',
    'id="wheelDirection"',
    'id="wheelPreset"',
    'id="wheelSensitivity"',
    'id="wheelCooldownMs"',
    'id="wheelAcceleration"',
    'id="skipPinnedTabs"',
    'id="skipHiddenTabs"',
    'id="wrapAround"',
    'id="cycleWithinTabGroup"',
  ]);
  assert.match(html, /<strong>Where it works<\/strong>[\s\S]*<ul>/);
  assert.match(html, /id="refreshTabWheelBtn"[\s\S]*id="resetDefaults"/);
  assert.match(source, /populateClickActionSelect/);
  assert.match(source, /browser\.tabs\.query\(\{\s*active:\s*true,\s*currentWindow:\s*true\s*\}\)/);
  assert.match(source, /cycleTabWheel\("prev",\s*"popup",\s*activeTab\?\.windowId\)/);
  assert.match(source, /cycleTabWheel\("next",\s*"popup",\s*activeTab\?\.windowId\)/);
  assert.match(source, /refreshCurrentTabWheel/);
  assert.match(source, /resetTabWheelState/);
  assert.match(source, /invertScroll:\s*wheelDirection\.value === "previous"/);
  assert.doesNotMatch(`${html}\n${source}`, /Retry on this page|openOptionsBtn|cycleScope|pageScroll/i);
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
    'id="leftClickAction"',
    'id="middleClickAction"',
    'id="rightClickAction"',
    'id="wheelDirection"',
    'id="wheelPreset"',
    'id="wheelSensitivity"',
    'id="wheelCooldownMs"',
    'id="wheelAcceleration"',
    'id="skipPinnedTabs"',
    'id="skipHiddenTabs"',
    'id="wrapAround"',
    'id="cycleWithinTabGroup"',
  ]);
  assert.match(html, /<strong>Where it works<\/strong>[\s\S]*<ul>/);
  assert.match(source, /moves through your \$\{direction\} tabs/);
  assert.match(source, /invertScroll:\s*wheelDirection\.value === "previous"/);
  assert.match(source, /leftClickAction:\s*leftClickAction\.value/);
  assert.match(source, /middleClickAction:\s*middleClickAction\.value/);
  assert.match(source, /rightClickAction:\s*rightClickAction\.value/);
  assert.doesNotMatch(`${html}\n${source}`, /One Gesture|id="restorePagePosition"|<details|cycleScope|pageScrollSpeedMultiplier|searchUrlTemplate/);
});

test("onboarding gesture choices match the visible settings order", () => {
  const html = readText("src/entryPoints/onboarding/onboarding.html");
  const source = readText("src/entryPoints/onboarding/onboarding.ts");
  assertOrdered(html, [
    'id="gestureModifier"',
    'id="gestureWithShift"',
    'id="leftClickAction"',
    'id="middleClickAction"',
    'id="rightClickAction"',
  ]);
  assert.match(html, /id="clickGestureDemo"/);
  assert.match(html, /id="browserSimulator"/);
  assert.match(html, /data-preview-button="0"/);
  assert.match(html, /data-preview-button="1"/);
  assert.match(html, /data-preview-button="2"/);
  assert.match(html, /id="introLeftClickAction"/);
  assert.match(html, /id="introMiddleClickAction"/);
  assert.match(html, /id="introRightClickAction"/);
  assert.match(source, /introActionSelects\.forEach/);
  assert.match(source, /actionSelects\[index\]\.value = select\.value/);
  assert.match(source, /previewAction\(selectedAction\(index\), index\)/);
  assert.match(source, /clickDemoActionHandler/);
  assert.match(source, /renderSimulatedResult/);
  assert.doesNotMatch(html, /id="direction"/);
});

test("build includes onboarding in both browser targets", () => {
  const build = readText("esBuildConfig/build.mjs");
  assert.match(build, /onboarding\/onboarding\.ts/);
  assert.match(build, /onboarding\/onboarding\.html/);
  assert.match(build, /onboarding\/onboarding\.css/);
});
