# Middle-click Drag Default and Cold-start Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship modifier + middle click as Drag current tab by default and make TabWheel work on eligible restored tabs after browser startup without reloading or waking discarded tabs.

**Architecture:** The mouse default remains centralized in `DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS`, which settings normalization and reset behavior already consume. Startup activation reuses the existing cross-browser programmatic injection path from `runtime.onStartup`, isolates injection from fallible housekeeping, awaits an initial pass, and repeats once after two seconds for late session restoration. The current branch already contains candidate commits, so execution verifies those commits first and changes code only for a demonstrated requirement gap.

**Tech Stack:** TypeScript, WebExtensions, `webextension-polyfill`, Node.js test runner, esbuild, npm

## Global Constraints

- Fresh installs and reset-to-defaults use `dragCurrentTab` for `middleClickAction`.
- Every valid saved middle-click mapping remains unchanged during normalization and upgrade.
- Startup activation uses Manifest V3 `scripting.executeScript` and Manifest V2 `tabs.executeScript` through the existing adapter path.
- Startup activation never reloads or navigates tabs.
- Browser-restricted and discarded tabs are not injected or awakened at startup.
- Activating a previously discarded tab ensures its content script after the browser wakes it.
- A housekeeping or per-tab injection failure cannot abort activation of other eligible tabs.
- Repeated content-script injection must not stack event listeners.
- Product documentation, onboarding, SVG sources, and submitted PNG assets must agree with the default.
- Preserve unrelated user work; do not reset, clean, or overwrite out-of-scope changes.
- Any repair follows test-driven development: observe a behavior-specific failure before production edits, then apply the smallest fix.

---

### Task 1: Verify the middle-click default and saved-setting compatibility

**Files:**

- Verify or modify: `src/lib/core/tabWheel/mouseGestureCore.ts`
- Verify: `src/lib/common/contracts/tabWheel.ts`
- Verify: `src/lib/common/utils/storageMigrations.ts`
- Verify or modify: `README.md`
- Verify or modify: `STORE.md`
- Verify or modify: `src/entryPoints/onboarding/onboarding.html`
- Verify or modify: `store-assets/source/02-one-natural-gesture.svg`
- Verify or modify: `store-assets/source/03-popup-ready.svg`
- Verify or modify: `store-assets/source/04-keep-your-place.svg`
- Verify or modify: `store-assets/source/05-protected-page-fallback.svg`
- Regenerate only if SVG copy changes: `store-assets/*.png`
- Test: `test/mouse-gesture-core.test.mjs`
- Test: `test/runtime-wiring.test.mjs`
- Test: `test/upgrade-migrations.test.mjs`
- Test: `test/upgrade-path.test.mjs`
- Test: `test/store-policy.test.mjs`
- Test: `test/docs-consistency.test.mjs`

**Interfaces:**

- Consumes: `DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS`, `DEFAULT_TABWHEEL_SETTINGS`, `normalizeTabWheelSettings(value)`, `migrateStorageSnapshot(storage)`
- Produces: default `middleClickAction: "dragCurrentTab"`; no new public type, storage key, schema version, permission, or runtime message

- [ ] **Step 1: Initialize the adversarial receipt**

Run:

```bash
adversarial_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
adversarial_workspace=$(/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/adversarial-workspace middle-drag-cold-start-20260731)
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/receipt init "$adversarial_workspace/receipt.json" --run-id middle-drag-cold-start-20260731 --task-label middle-drag-cold-start --git-mode clean-worktree --started-at "$adversarial_started_at" --trigger lifecycle --trigger public-contract
```

Expected: `.superpowers/adversarial/middle-drag-cold-start-20260731/receipt.json` exists with an empty finding list. If the execution worktree begins dirty, use `--git-mode dirty-snapshot` and capture the starting tree with `snapshot-tree capture`.

- [ ] **Step 2: Run the focused default, normalization, migration, and copy checks**

Run:

```bash
node --test test/mouse-gesture-core.test.mjs test/runtime-wiring.test.mjs test/upgrade-migrations.test.mjs test/upgrade-path.test.mjs test/store-policy.test.mjs test/docs-consistency.test.mjs
```

Expected: exit code 0. The default middle-button policy is `{ action: "dragCurrentTab", button: 1, interaction: "drag" }`; migration tests preserve existing valid mappings; public copy and store assets agree.

- [ ] **Step 3: Audit the candidate implementation against the exact contract**

The production default must be exactly:

```typescript
export const DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS: TabWheelClickActionSettings = {
  leftClickAction: "nativeNewTab",
  middleClickAction: "dragCurrentTab",
  rightClickAction: "closeToRecent",
};
```

Confirm `DEFAULT_TABWHEEL_SETTINGS` spreads this object, reset removes stored settings so normalization returns this object, and no migration assigns over a valid `middleClickAction`. Confirm user-facing default copy says “Drag current tab,” not “Most recent tab,” for middle click.

- [ ] **Step 4: Add a missing regression guard before any production repair**

If the default-policy guard is absent, add this assertion to `test/mouse-gesture-core.test.mjs`:

```javascript
assert.deepEqual(policies, [
  { action: "nativeNewTab", button: 0, interaction: "click", runPhase: "click" },
  { action: "dragCurrentTab", button: 1, interaction: "drag" },
  { action: "closeToRecent", button: 2, interaction: "click", runPhase: "contextmenu" },
]);
```

If upgrade preservation is absent, use the existing esbuild migration loader and add:

```javascript
const result = migrations.migrateStorageSnapshot({
  storageSchemaVersion: 18,
  tabWheelSettings: {
    leftClickAction: "nativeNewTab",
    middleClickAction: "recentTab",
    rightClickAction: "closeToRecent",
  },
});
assert.equal(result.migratedStorage.tabWheelSettings.middleClickAction, "recentTab");
```

- [ ] **Step 5: Observe RED, then apply the minimal repair**

Run:

```bash
node --test test/mouse-gesture-core.test.mjs test/upgrade-migrations.test.mjs
```

Expected when a gap exists: FAIL because the default is not `dragCurrentTab` or a migration overwrites `recentTab`. Import, syntax, and fixture errors do not count. Then change only the default object to the Step 3 value or remove only the migration overwrite. Do not increment `STORAGE_SCHEMA_VERSION`.

If SVG copy changes, regenerate its PNG outputs with the repository command:

```bash
for source in store-assets/source/*.svg; do
  magick -background none "$source" "store-assets/$(basename "${source%.svg}").png"
done
```

If Steps 2–3 already pass, make no test or production edit; the candidate commits already contain the required guard and implementation.

- [ ] **Step 6: Verify GREEN and commit only an actual repair**

Run:

```bash
node --test test/mouse-gesture-core.test.mjs test/runtime-wiring.test.mjs test/upgrade-migrations.test.mjs test/upgrade-path.test.mjs test/store-policy.test.mjs test/docs-consistency.test.mjs
git diff --check
```

Expected: both commands exit 0. If Task 1 changed files, commit only those files with `git commit -m "fix: preserve middle-drag default contract"`. Do not create an empty commit.

---

### Task 2: Verify restored-tab activation across browser startup

**Files:**

- Verify or modify: `src/lib/backgroundRuntime/domains/tabWheelDomain.ts`
- Verify: `src/lib/appInit/appInit.ts`
- Verify: `esBuildConfig/manifest_v3.json`
- Verify: `esBuildConfig/manifest_v2.json`
- Test: `test/zero-reload.test.mjs`
- Test: `test/runtime-wiring.test.mjs`
- Test: `test/compatibility.test.mjs`
- Test: `test/async-flow.test.mjs`

**Interfaces:**

- Consumes: `browser.runtime.onStartup`, `activateExistingContentScripts()`, `ensureActiveTabContentScripts()`, `ensureContentScriptForActiveTab(tabId)`, `sleep(ms)`
- Produces: startup reinjection for eligible loaded restored tabs through existing MV3/MV2 APIs; no new permissions, storage keys, or runtime messages

- [ ] **Step 1: Run focused startup and compatibility checks**

Run:

```bash
node --test test/zero-reload.test.mjs test/runtime-wiring.test.mjs test/compatibility.test.mjs test/async-flow.test.mjs
```

Expected: exit code 0. The suite finds both script-execution APIs, an awaited `onStartup` activation pass, active-tab readiness, a two-second retry, the reinjection cleanup guard, and no `tabs.reload` call.

- [ ] **Step 2: Audit execution, eligibility, and wake-up paths**

Confirm the adapter contains both calls:

```typescript
await runtimeBrowser.scripting.executeScript({
  target: { tabId, ...(allFrames ? { allFrames: true } : {}) },
  files: ["contentScript.js"],
});

await runtimeBrowser.tabs.executeScript(tabId, {
  file: "contentScript.js",
  runAt: "document_start",
  ...(allFrames ? { allFrames: true } : {}),
});
```

`injectContentScriptIntoTab` must skip missing IDs, `tab.discarded === true`, and restricted URLs. `tabs.onActivated` must call `ensureContentScriptForActiveTab(activeInfo.tabId)` so a lazy-restored tab is injected only after the browser wakes it.

- [ ] **Step 3: Add a missing startup guard before any production repair**

The startup test must isolate the registered handler and assert:

```javascript
assertOrdered(startupHandlerSource, [
  "await ensureLoaded()",
  "await browser.storage.local.remove(TABWHEEL_STORAGE_KEYS.recentTabs)",
  "await activateExistingContentScripts()",
  "await ensureActiveTabContentScripts()",
]);
assert.match(startupHandlerSource, /startup housekeeping failed/);
assert.match(startupHandlerSource, /await sleep\(2000\)/);
assert.doesNotMatch(startupHandlerSource, /browser\.tabs\.reload\s*\(/);
```

The adapter guard must assert `scripting.executeScript`, `tabs.executeScript`, `contentScript.js`, all-frame targeting, and top-frame fallback. The content-script guard must assert `initApp()` begins with `window.__tabWheelCleanup?.();`.

- [ ] **Step 4: Observe RED, then apply the minimal lifecycle repair**

Run:

```bash
node --test test/zero-reload.test.mjs
```

Expected when a gap exists: FAIL on a missing startup pass, retry, cross-browser API, no-reload invariant, or cleanup guard. Then retain existing housekeeping in its own `try`/`catch` and add only this activation flow:

```typescript
const activateRestoredTabs = async (): Promise<void> => {
  await activateExistingContentScripts();
  await ensureActiveTabContentScripts();
};

try {
  await activateRestoredTabs();
} catch (error) {
  console.warn("[TabWheel] startup content script activation failed:", error);
}

try {
  await sleep(2000);
  await activateRestoredTabs();
} catch (error) {
  console.warn("[TabWheel] delayed startup content script activation failed:", error);
}
```

Do not add a reload, navigation, alarm, persistent timer, permission, or forced wake of discarded tabs. If Steps 1–2 already pass, make no code edit.

- [ ] **Step 5: Verify GREEN and commit only an actual repair**

Run:

```bash
node --test test/zero-reload.test.mjs test/runtime-wiring.test.mjs test/compatibility.test.mjs test/async-flow.test.mjs
npm run typecheck
git diff --check
```

Expected: all commands exit 0. If Task 2 changed files, commit only those files with `git commit -m "fix: activate restored tabs on browser startup"`. Do not create an empty commit.

---

### Task 3: Run independent review, repair admitted findings, and verify the release surface

**Files:**

- Review: complete `main...HEAD` diff and relevant surrounding files
- Receipt: `.superpowers/adversarial/middle-drag-cold-start-20260731/receipt.json`
- Guardrails: `test/mouse-gesture-core.test.mjs`, `test/upgrade-migrations.test.mjs`, `test/zero-reload.test.mjs`, `test/store-policy.test.mjs`
- Verify: all files reached by `npm run ci`

**Interfaces:**

- Consumes: approved design spec, candidate diff, focused command output, reviewer contracts
- Produces: admitted findings resolved or explicitly blocked, authoritative verification evidence, finalized receipt

- [ ] **Step 1: Dispatch independent Reviewer A and Reviewer B concurrently**

Reviewer A uses `gpt-5.6-sol` with high effort and receives only the approved spec path, applicable repository instructions, `git diff main...HEAD`, and exact focused command results. It checks coverage, correctness, regressions, error handling, compatibility, and tests, then returns only the Reviewer A format from `adversarial-development/references/reviewer-contracts.md`.

Reviewer B is mandatory for lifecycle work. It uses `gpt-5.6-sol` with high effort and receives only the diff, command results, and these binding invariants: no reload/navigation, no waking discarded tabs, valid saved mappings preserved, housekeeping cannot gate injection, initial and delayed failures isolated, reinjection does not stack listeners, both manifests remain supported, and permissions do not widen. It returns only the Reviewer B contract. Neither reviewer edits files, sees the other's verdict, receives controller reasoning, or spawns agents.

Record both stages in the receipt with `routing-status unverified` and unavailable token usage unless the runtime provides authoritative model, effort, and token metadata.

- [ ] **Step 2: Adjudicate and repair within the closed scope**

Accept only findings with a concrete supported failure path or violated binding requirement. Return every Critical or Important finding verbatim in the execution report and record its receipt disposition. Reject unsupported platforms, documented protected-page limitations, style preferences, and concerns without reproduction or missing evidence.

For each admitted finding, resume the writer for rounds 1–3. The writer adds or strengthens a regression guard, observes RED, applies the smallest fix, and reruns the focused command. Rounds 4–5 use a fresh `gpt-5.6-sol` high-effort writer. An unresolved load-bearing finding after round 5 blocks completion.

- [ ] **Step 3: Run scoped re-review and final whole-change review**

Use a fresh `gpt-5.6-terra` medium-effort reviewer for each fix-only scoped re-review. Supply original open findings, the fix-only diff, and focused evidence; require `ADDRESSED` or `OPEN` for every item. Admit a new finding only if the fix diff introduced Critical or Important breakage.

Then dispatch a fresh `gpt-5.6-sol` high-effort whole-change reviewer over the approved spec, complete diff, invariants, and fresh focused evidence. Allow at most one final fix wave and one scoped re-review, then adjudicate residuals once.

- [ ] **Step 4: Run authoritative verification from the final tree**

Run:

```bash
npm run ci
git diff --check main...HEAD
git status --short --branch
```

Expected: CI exits 0 after lint, all tests, type checking, compatibility, upgrade, store, Firefox build, and Chrome build; diff check exits 0; status contains no unexpected changes. Record every command and exit code in the receipt.

- [ ] **Step 5: Finalize the receipt**

Run after admitted findings are resolved and verification passes:

```bash
adversarial_ended_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/receipt guardrail "$adversarial_workspace/receipt.json" --kind regression-test --path test/mouse-gesture-core.test.mjs
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/receipt guardrail "$adversarial_workspace/receipt.json" --kind regression-test --path test/zero-reload.test.mjs
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/receipt guardrail "$adversarial_workspace/receipt.json" --kind static-check --path test/store-policy.test.mjs
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/receipt finalize "$adversarial_workspace/receipt.json" --verdict passed --fix-rounds 0 --ended-at "$adversarial_ended_at"
/home/reklai/.config/archstate-src/home/.codex/skills/adversarial-development/scripts/adversarial-workspace finalize "$adversarial_workspace"
```

Use the actual repair-round count instead of `0` when fixes occurred. Expected: finalization prints the retained `receipt.json` path and removes intermediate review artifacts.

- [ ] **Step 6: Hand off browser smoke tests**

Reload the unpacked extension in Chrome and Firefox, then restart each browser with one loaded eligible page, one discarded/lazy-restored page, and one protected browser page. Confirm the loaded page accepts modifier-wheel and modifier + middle-drag without reload; the discarded page stays asleep until selected and then accepts gestures; the protected page retains the toolbar fallback; and a saved non-default middle-click mapping survives restart and extension update.
