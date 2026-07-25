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
  assert.match(migrations, /STORAGE_SCHEMA_VERSION = 15/);
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

test("focused v15 migration backfills the device-tuning and restricted-badge settings", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(migrations, /if \(fromVersion < 15\)/);
  assert.match(migrations, /backfillFeelAndReliabilitySettings\(migratedStorage\)/);
  assert.match(migrations, /"deviceAwareTuning"/);
  assert.match(migrations, /"showRestrictedBadge"/);
});

test("migration does not downgrade storage created by a future release", () => {
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");
  assert.match(
    migrations,
    /if \(fromVersion > STORAGE_SCHEMA_VERSION\)[\s\S]*toVersion:\s*fromVersion[\s\S]*changed:\s*false/,
  );
});
