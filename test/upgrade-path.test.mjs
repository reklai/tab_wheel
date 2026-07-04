import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readText(pathFromRoot) {
  return readFileSync(resolve(root, pathFromRoot), "utf8");
}

test("TabWheel storage keys are stable and isolated from legacy storage", () => {
  const contract = readText("src/lib/common/contracts/tabWheel.ts");
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const migrations = readText("src/lib/common/utils/storageMigrations.ts");

  assert.match(contract, /scrollMemory:\s*"tabWheelScrollMemory"/);
  assert.match(contract, /mruState:\s*"tabWheelMruState"/);
  assert.match(contract, /settings:\s*"tabWheelSettings"/);
  assert.doesNotMatch(contract, /tabWheelSessions|MAX_TABWHEEL_SESSIONS/);
  assert.match(domain, /TABWHEEL_STORAGE_KEYS\.scrollMemory/);
  assert.match(domain, /TABWHEEL_STORAGE_KEYS\.mruState/);
  assert.match(domain, /browser\.storage\.local\.set\(\{\s*\[TABWHEEL_STORAGE_KEYS\.scrollMemory\]/);
  assert.match(domain, /browser\.storage\.local\.set\(\{\s*\[TABWHEEL_STORAGE_KEYS\.mruState\]/);
  assert.match(migrations, /export const STORAGE_SCHEMA_VERSION = 13/);
  assert.match(migrations, /deleteKey\(migratedStorage,\s*"frecencyData"\)/);
  assert.match(migrations, /TABWHEEL_LEGACY_TAGGED_TABS_KEY = "tabWheelTaggedTabs"/);
  assert.match(migrations, /TABWHEEL_WHEEL_LIST_KEY = "tabWheelWheelList"/);
  assert.match(migrations, /deleteKey\(migratedStorage,\s*TABWHEEL_LEGACY_TAGGED_TABS_KEY\)/);
  assert.match(migrations, /deleteKey\(migratedStorage,\s*TABWHEEL_WHEEL_LIST_KEY\)/);
  assert.match(migrations, /deleteKey\(migratedStorage,\s*TABWHEEL_MRU_STATE_KEY\)/);
  assert.match(migrations, /deleteKey\(nextSettings,\s*"cycleOrder"\)/);
  assert.match(migrations, /deleteKey\(nextSettings,\s*"searchUrlTemplate"\)/);
  assert.match(migrations, /deleteSettingKey\(migratedStorage,\s*"searchUrlTemplate"\)/);
  assert.match(migrations, /deleteSettingKey\(migratedStorage,\s*"showCycleToast"\)/);
  assert.match(migrations, /removeScrollMemoryWithoutUrls\(migratedStorage\)/);
  assert.match(migrations, /removeScrollMemoryZoom\(migratedStorage\)/);
  assert.match(migrations, /openNativeNewTabOnLeftClick = false/);
  assert.match(migrations, /migrateClickActionSettings\(migratedStorage\)/);
  assert.match(migrations, /openNativeNewTabOnLeftClick === true[\s\S]*"nativeNewTab"/);
  assert.match(migrations, /deleteKey\(nextSettings,\s*"openNativeNewTabOnLeftClick"\)/);
  assert.match(migrations, /if \(fromVersion > STORAGE_SCHEMA_VERSION\)[\s\S]*return \{[\s\S]*fromVersion[\s\S]*toVersion:\s*fromVersion[\s\S]*changed:\s*false[\s\S]*migratedStorage/);
  assert.match(migrations, /function isClickActionValue\(value: unknown\): boolean[\s\S]*TABWHEEL_CLICK_ACTION_VALUES\.includes\(value\)/);
  assert.match(migrations, /if \(isClickActionValue\(nextSettings\[settingKey\]\)\) continue/);
  assert.doesNotMatch(migrations, /tabManagerList|tabManagerSessions|anchorTagsByTabId|keybindings/);
});
