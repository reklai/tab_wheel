# Left-click Browser New Tab Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and, only if necessary, complete Browser New Tab as the default modifier + left-click action while preserving every valid saved user mapping.

**Architecture:** `DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS` remains the single default source consumed by the shared settings contract and UI reset paths. Storage migrations may backfill a missing or invalid action, but must not replace a valid action. Because the current V4 worktree already contains this design, execution begins with behavioral verification and adds code only for a demonstrated gap.

**Tech Stack:** TypeScript, WebExtensions, Node.js test runner, esbuild, npm

## Global Constraints

- Fresh installs use `nativeNewTab` for `leftClickAction`.
- Reset to defaults restores `nativeNewTab` for `leftClickAction`.
- Missing or invalid stored left-click actions normalize to `nativeNewTab`.
- Every valid saved left-click action is preserved during upgrade.
- Do not stage, reset, clean, or overwrite unrelated dirty-worktree changes.

---

### Task 1: Verify the default and preservation contract

**Files:**
- Verify: `src/lib/core/tabWheel/mouseGestureCore.ts`
- Verify: `src/lib/common/contracts/tabWheel.ts`
- Verify: `src/lib/common/utils/storageMigrations.ts`
- Test: `test/mouse-gesture-core.test.mjs`
- Test: `test/upgrade-migrations.test.mjs`
- Test: `test/upgrade-path.test.mjs`
- Test: `test/runtime-wiring.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS`, `DEFAULT_TABWHEEL_SETTINGS`, `normalizeTabWheelSettings(value)`, and `migrateStorageSnapshot(storage)`
- Produces: verified default and upgrade behavior; no new public interface

- [ ] **Step 1: Run the mouse-policy default test**

Run:

```bash
node test/mouse-gesture-core.test.mjs
```

Expected: PASS, including a left-button policy with
`action: "nativeNewTab"` and `runPhase: "click"`.

- [ ] **Step 2: Run upgrade-preservation tests**

Run:

```bash
node --test test/upgrade-migrations.test.mjs test/upgrade-path.test.mjs
```

Expected: PASS, including preservation of valid `nativeNewTab` and
`dragCurrentTab` mappings and a `nativeNewTab` fallback for absent mappings.

- [ ] **Step 3: Run settings/reset wiring checks**

Run:

```bash
node --test test/runtime-wiring.test.mjs
```

Expected: PASS. Both settings surfaces reset through
`DEFAULT_TABWHEEL_SETTINGS`, whose left-click action derives from
`DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS`.

- [ ] **Step 4: Repair only a demonstrated gap**

If a command above fails because the approved behavior is absent, first add a
minimal behavioral regression case to the failing test file and run it to
confirm the expected failure. Then make the smallest corresponding change in
`mouseGestureCore.ts`, `tabWheel.ts`, or `storageMigrations.ts` and rerun the
focused command until it passes. If all focused checks pass initially, make no
production or test change.

- [ ] **Step 5: Run authoritative verification**

Run:

```bash
npm run ci
git diff --check
```

Expected: exit code 0; lint, all tests, typecheck, compatibility and store
checks, and Firefox and Chrome builds pass.

- [ ] **Step 6: Review the scoped result**

Review only changes made while executing this plan. If Step 4 made no code
change, record that the existing V4 implementation already satisfies the
approved contract. If Step 4 changed behavior, run the adversarial-development
review and re-review cycle before completion.

- [ ] **Step 7: Hand off the smoke test**

Reload the extension, choose **Reset to defaults**, hold the configured
modifier, and left-click a normal webpage. Confirm that the browser New Tab page
opens beside the current tab. Then restore any custom mapping desired for
continued use.
