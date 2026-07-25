import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("focused v14 migration preserves core state and removes retired state", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(contract, /settings:\s*"tabWheelSettings"/);
  assert.match(contract, /scrollMemory:\s*"tabWheelScrollMemory"/);
  assert.match(contract, /mruState:\s*"tabWheelMruState"/);
  assert.match(contract, /onboarding:\s*"tabWheelOnboarding"/);
  assert.match(migrations, /STORAGE_SCHEMA_VERSION = 17/);
  assert.match(migrations, /focusTabWheelSettings\(migratedStorage\)/);
  assert.match(migrations, /deleteKey\(migratedStorage,\s*TABWHEEL_SEARCH_HISTORY_KEY\)/);
  assert.match(migrations, /"leftClickAction"/);
  assert.match(migrations, /"pageScrollSpeedMultiplier"/);
  assert.match(migrations, /nextSettings\.middleClickAction !== "openSettings"/);
  assert.doesNotMatch(migrations, /\[\s*"leftClickAction",\s*"middleClickAction"/);
  assert.match(migrations, /"restorePagePosition"/);
  assert.match(migrations, /"wrapAround"/);
  assert.match(migrations, /"horizontalWheel"/);
  assert.match(migrations, /nextSettings\[key\] = true/);
  assert.match(migrations, /nextSettings\.skipHiddenTabs = true/);
});

test("focused v15 migration backfills the reliability settings it introduced", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(migrations, /if \(fromVersion < 15\)/);
  assert.match(migrations, /backfillFeelAndReliabilitySettings\(migratedStorage\)/);
  assert.match(migrations, /"showRestrictedBadge"/);
  // v15 also backfilled deviceAwareTuning. Historical steps stay frozen, so
  // the key is still added here and deleted again by v16 below — the net
  // effect for any snapshot older than 16 is that it never appears.
  assert.match(migrations, /for \(const key of \["deviceAwareTuning", "showRestrictedBadge"\]\)/);
});

test("focused v16 migration removes the retired auto-tuning state", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(migrations, /if \(fromVersion < 16\)/);
  assert.match(migrations, /removeDeviceTuningState\(migratedStorage\)/);
  // Both halves: the preference inside settings, and the shared profile key
  // the classifier wrote. Local literals, so renaming a live contract can
  // never change how old storage is cleaned up.
  assert.match(migrations, /deleteSettingKey\(storage, "deviceAwareTuning"\)/);
  assert.match(migrations, /const TABWHEEL_DEVICE_PROFILE_KEY = "tabWheelDeviceProfile";/);
  assert.match(migrations, /deleteKey\(storage, TABWHEEL_DEVICE_PROFILE_KEY\)/);
});

test("focused v17 migration backfills the cycle-within-group setting it introduced", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(migrations, /if \(fromVersion < 17\)/);
  assert.match(migrations, /backfillCycleWithinTabGroupSetting\(migratedStorage\)/);
  assert.match(migrations, /typeof nextSettings\.cycleWithinTabGroup !== "boolean"/);
  assert.match(migrations, /nextSettings\.cycleWithinTabGroup = false;/);
  // wrapAround needs no v17 backfill of its own: an absent key already
  // normalizes to true by default, the same value the old force-true rule
  // produced, so no upgrading profile's effective behavior depends on it.
  assert.doesNotMatch(
    migrations.slice(migrations.indexOf("function backfillCycleWithinTabGroupSetting(")),
    /wrapAround/,
  );
});

test("migration does not downgrade storage created by a future release", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");
  assert.match(
    migrations,
    /if \(fromVersion > STORAGE_SCHEMA_VERSION\)[\s\S]*toVersion:\s*fromVersion[\s\S]*changed:\s*false/,
  );
});
