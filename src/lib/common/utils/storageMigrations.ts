export const STORAGE_SCHEMA_VERSION_KEY = "storageSchemaVersion";
const TABWHEEL_SETTINGS_KEY = "tabWheelSettings";
const TABWHEEL_SCROLL_MEMORY_KEY = "tabWheelScrollMemory";
const TABWHEEL_MRU_STATE_KEY = "tabWheelMruState";
const TABWHEEL_SEARCH_HISTORY_KEY = "tabWheelSearchHistory";
const TABWHEEL_LEGACY_TAGGED_TABS_KEY = "tabWheelTaggedTabs";
const TABWHEEL_WHEEL_LIST_KEY = "tabWheelWheelList";
const TABWHEEL_DEVICE_PROFILE_KEY = "tabWheelDeviceProfile";
export const STORAGE_SCHEMA_VERSION = 17;

type StorageSnapshot = Record<string, unknown>;

export interface StorageMigrationResult {
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  migratedStorage: StorageSnapshot;
}

function readSchemaVersion(storage: StorageSnapshot): number {
  const numeric = Number(storage[STORAGE_SCHEMA_VERSION_KEY]);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : 0;
}

function isFreshInstallSnapshot(storage: StorageSnapshot): boolean {
  const keys = Object.keys(storage);
  return keys.length === 0 || keys.every((key) => key === STORAGE_SCHEMA_VERSION_KEY);
}

export function isStorageSchemaVersionCurrent(rawVersion: unknown): boolean {
  return Number(rawVersion) === STORAGE_SCHEMA_VERSION;
}

export function createCurrentVersionMigrationResult(): StorageMigrationResult {
  return {
    fromVersion: STORAGE_SCHEMA_VERSION,
    toVersion: STORAGE_SCHEMA_VERSION,
    changed: false,
    migratedStorage: {},
  };
}

function hasKey(storage: StorageSnapshot, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(storage, key);
}

function deleteKey(storage: StorageSnapshot, key: string): boolean {
  if (!hasKey(storage, key)) return false;
  delete storage[key];
  return true;
}

function enableEditableFieldsByDefault(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    storage[TABWHEEL_SETTINGS_KEY] = { allowGesturesInEditableFields: true };
    return true;
  }
  const nextSettings = {
    ...(settings as Record<string, unknown>),
    allowGesturesInEditableFields: true,
  };
  const changed = (settings as Record<string, unknown>).allowGesturesInEditableFields !== true;
  storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

function deleteSettingKey(storage: StorageSnapshot, key: string): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return false;
  const nextSettings = { ...(settings as Record<string, unknown>) };
  if (!deleteKey(nextSettings, key)) return false;
  storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return true;
}

function migrateTabWheelSettings(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  const hasExistingSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
  const nextSettings = hasExistingSettings ? { ...(settings as Record<string, unknown>) } : {};
  let changed = !hasExistingSettings;

  if (nextSettings.cycleScope !== "general" && nextSettings.cycleScope !== "mru") {
    nextSettings.cycleScope = "general";
    changed = true;
  }
  if (typeof nextSettings.skipRestrictedPages !== "boolean") {
    nextSettings.skipRestrictedPages = true;
    changed = true;
  }
  if (typeof nextSettings.openNativeNewTabOnLeftClick !== "boolean") {
    nextSettings.openNativeNewTabOnLeftClick = false;
    changed = true;
  }
  if (deleteKey(nextSettings, "searchUrlTemplate")) changed = true;
  if (deleteKey(nextSettings, "cycleOrder")) changed = true;
  if (typeof nextSettings.wheelPreset !== "string") {
    nextSettings.wheelPreset = "balanced";
    changed = true;
  }
  if (typeof nextSettings.horizontalWheel !== "boolean") {
    nextSettings.horizontalWheel = true;
    changed = true;
  }
  if (typeof nextSettings.overshootGuard !== "boolean") {
    nextSettings.overshootGuard = true;
    changed = true;
  }
  if (typeof nextSettings.wheelAcceleration !== "boolean") {
    nextSettings.wheelAcceleration = false;
    changed = true;
  }
  if (typeof nextSettings.wheelCooldownMs !== "number") {
    nextSettings.wheelCooldownMs = 160;
    changed = true;
  }
  if (typeof nextSettings.wheelSensitivity !== "number") {
    nextSettings.wheelSensitivity = 1;
    changed = true;
  }
  if (typeof nextSettings.pageScrollSpeedMultiplier !== "number") {
    nextSettings.pageScrollSpeedMultiplier = 1;
    changed = true;
  }
  if (typeof nextSettings.pageScrollViewportCapRatio !== "number") {
    nextSettings.pageScrollViewportCapRatio = 1;
    changed = true;
  }

  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

// Keep historical migration values local to this file. Importing live contracts
// would let future edits change how old profiles are upgraded.
const TABWHEEL_CLICK_ACTION_VALUES = [
  "search",
  "nativeNewTab",
  "recentTab",
  "closeToRecent",
  "duplicateTab",
  "openSettings",
  "none",
];

function isClickActionValue(value: unknown): boolean {
  return typeof value === "string" && TABWHEEL_CLICK_ACTION_VALUES.includes(value);
}

function migrateClickActionSettings(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  const hasExistingSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
  const nextSettings = hasExistingSettings ? { ...(settings as Record<string, unknown>) } : {};
  let changed = !hasExistingSettings;

  const clickActionFallbacks: ReadonlyArray<[string, string]> = [
    ["leftClickAction", nextSettings.openNativeNewTabOnLeftClick === true ? "nativeNewTab" : "search"],
    ["middleClickAction", "recentTab"],
    ["rightClickAction", "closeToRecent"],
  ];
  for (const [settingKey, fallback] of clickActionFallbacks) {
    if (isClickActionValue(nextSettings[settingKey])) continue;
    nextSettings[settingKey] = fallback;
    changed = true;
  }
  if (deleteKey(nextSettings, "openNativeNewTabOnLeftClick")) changed = true;

  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

function focusTabWheelSettings(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return false;
  const nextSettings = { ...(settings as Record<string, unknown>) };
  let changed = false;

  for (const key of [
    "leftClickAction",
    "rightClickAction",
    "openNativeNewTabOnLeftClick",
    "pageScrollSpeedMultiplier",
    "pageScrollViewportCapRatio",
  ]) {
    changed = deleteKey(nextSettings, key) || changed;
  }

  if (nextSettings.middleClickAction !== "openSettings" && nextSettings.middleClickAction !== "none") {
    nextSettings.middleClickAction = "openSettings";
    changed = true;
  }

  for (const key of [
    "allowGesturesInEditableFields",
    "restorePagePosition",
    "skipRestrictedPages",
    "wrapAround",
    "horizontalWheel",
    "overshootGuard",
  ]) {
    if (nextSettings[key] === true) continue;
    nextSettings[key] = true;
    changed = true;
  }
  if (typeof nextSettings.skipHiddenTabs !== "boolean") {
    nextSettings.skipHiddenTabs = true;
    changed = true;
  }

  // An old Custom preset may have differed only through the retired page-scroll
  // controls. Re-label it when the remaining wheel values match a focused preset.
  if (nextSettings.wheelPreset === "custom") {
    const presets = [
      ["precise", 0.8, 220, false, true],
      ["balanced", 1, 160, false, true],
      ["fast", 1.35, 90, true, true],
    ] as const;
    const match = presets.find(([, sensitivity, cooldown, acceleration, guard]) =>
      nextSettings.wheelSensitivity === sensitivity
      && nextSettings.wheelCooldownMs === cooldown
      && nextSettings.wheelAcceleration === acceleration
      && nextSettings.overshootGuard === guard);
    if (match) {
      nextSettings.wheelPreset = match[0];
      changed = true;
    }
  }

  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

function backfillFeelAndReliabilitySettings(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  const hasExistingSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
  const nextSettings = hasExistingSettings ? { ...(settings as Record<string, unknown>) } : {};
  let changed = !hasExistingSettings;

  for (const key of ["deviceAwareTuning", "showRestrictedBadge"]) {
    if (typeof nextSettings[key] === "boolean") continue;
    nextSettings[key] = true;
    changed = true;
  }

  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

// v16 retires the device classifier: the "Auto-tune for your device"
// preference and the profile key it wrote. The v15 backfill above still adds
// the setting on its way through — historical steps are left frozen — and this
// step removes it again, so no snapshot older than 16 keeps it either way.
// The profile is not a preference, so nothing replaces it: the wheel feel is
// whatever the preset says, on every device.
function removeDeviceTuningState(storage: StorageSnapshot): boolean {
  let changed = deleteSettingKey(storage, "deviceAwareTuning");
  changed = deleteKey(storage, TABWHEEL_DEVICE_PROFILE_KEY) || changed;
  return changed;
}

// v17 turns wrapAround into a normal user setting (see normalizeTabWheelSettings)
// and introduces cycleWithinTabGroup. wrapAround already has a value on every
// upgrading profile — earlier steps have forced it true since v14 — so it
// needs no backfill here; only the newly introduced key does.
function backfillCycleWithinTabGroupSetting(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  const hasExistingSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
  const nextSettings = hasExistingSettings ? { ...(settings as Record<string, unknown>) } : {};
  let changed = !hasExistingSettings;

  if (typeof nextSettings.cycleWithinTabGroup !== "boolean") {
    nextSettings.cycleWithinTabGroup = false;
    changed = true;
  }

  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return changed;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function removeScrollMemoryWithoutUrls(storage: StorageSnapshot): boolean {
  const scrollMemory = storage[TABWHEEL_SCROLL_MEMORY_KEY];
  if (typeof scrollMemory !== "object" || scrollMemory === null || Array.isArray(scrollMemory)) return false;
  const nextScrollMemory: Record<string, unknown> = {};
  let changed = false;

  for (const [key, rawEntry] of Object.entries(scrollMemory as Record<string, unknown>)) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      changed = true;
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    if (!isHttpUrl(entry.url)) {
      changed = true;
      continue;
    }
    nextScrollMemory[key] = entry;
  }

  if (changed) storage[TABWHEEL_SCROLL_MEMORY_KEY] = nextScrollMemory;
  return changed;
}

function removeScrollMemoryZoom(storage: StorageSnapshot): boolean {
  const scrollMemory = storage[TABWHEEL_SCROLL_MEMORY_KEY];
  if (typeof scrollMemory !== "object" || scrollMemory === null || Array.isArray(scrollMemory)) return false;
  const nextScrollMemory: Record<string, unknown> = {};
  let changed = false;

  for (const [key, rawEntry] of Object.entries(scrollMemory as Record<string, unknown>)) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      nextScrollMemory[key] = rawEntry;
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    if (!hasKey(entry, "zoom")) {
      nextScrollMemory[key] = entry;
      continue;
    }
    const nextEntry = { ...entry };
    delete nextEntry.zoom;
    nextScrollMemory[key] = nextEntry;
    changed = true;
  }

  if (changed) storage[TABWHEEL_SCROLL_MEMORY_KEY] = nextScrollMemory;
  return changed;
}

export function migrateStorageSnapshot(input: StorageSnapshot): StorageMigrationResult {
  const migratedStorage: StorageSnapshot = { ...input };
  const fromVersion = readSchemaVersion(input);

  if (fromVersion > STORAGE_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: fromVersion,
      changed: false,
      migratedStorage,
    };
  }

  if (fromVersion < STORAGE_SCHEMA_VERSION && isFreshInstallSnapshot(input)) {
    return {
      fromVersion,
      toVersion: STORAGE_SCHEMA_VERSION,
      changed: true,
      migratedStorage: {
        [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      },
    };
  }

  let changed = false;
  if (fromVersion < 2) {
    changed = deleteKey(migratedStorage, "frecencyData") || changed;
  }
  if (fromVersion === 2) {
    changed = deleteKey(migratedStorage, "frecencyData") || changed;
  }
  if (fromVersion < 4) {
    changed = deleteKey(migratedStorage, "tabWheelSessions") || changed;
  }
  if (fromVersion < 5) {
    changed = enableEditableFieldsByDefault(migratedStorage) || changed;
  }
  if (fromVersion < 6) {
    changed = deleteSettingKey(migratedStorage, "showCycleToast") || changed;
  }
  if (fromVersion < 7) {
    changed = removeScrollMemoryWithoutUrls(migratedStorage) || changed;
    changed = deleteKey(migratedStorage, TABWHEEL_MRU_STATE_KEY) || changed;
  }
  if (fromVersion < 8) {
    changed = deleteKey(migratedStorage, TABWHEEL_LEGACY_TAGGED_TABS_KEY) || changed;
    changed = deleteKey(migratedStorage, TABWHEEL_MRU_STATE_KEY) || changed;
    changed = migrateTabWheelSettings(migratedStorage) || changed;
  }
  if (fromVersion < 9) {
    changed = deleteKey(migratedStorage, TABWHEEL_LEGACY_TAGGED_TABS_KEY) || changed;
    changed = deleteKey(migratedStorage, TABWHEEL_WHEEL_LIST_KEY) || changed;
    changed = migrateTabWheelSettings(migratedStorage) || changed;
  }
  if (fromVersion < 10) {
    changed = removeScrollMemoryZoom(migratedStorage) || changed;
  }
  if (fromVersion < 11) {
    changed = migrateTabWheelSettings(migratedStorage) || changed;
  }
  if (fromVersion < 12) {
    changed = deleteSettingKey(migratedStorage, "searchUrlTemplate") || changed;
  }
  if (fromVersion < 13) {
    changed = migrateClickActionSettings(migratedStorage) || changed;
  }
  if (fromVersion < 14) {
    changed = focusTabWheelSettings(migratedStorage) || changed;
    changed = deleteKey(migratedStorage, TABWHEEL_SEARCH_HISTORY_KEY) || changed;
  }
  if (fromVersion < 15) {
    changed = backfillFeelAndReliabilitySettings(migratedStorage) || changed;
  }
  if (fromVersion < 16) {
    changed = removeDeviceTuningState(migratedStorage) || changed;
  }
  if (fromVersion < 17) {
    changed = backfillCycleWithinTabGroupSetting(migratedStorage) || changed;
  }

  if (migratedStorage[STORAGE_SCHEMA_VERSION_KEY] !== STORAGE_SCHEMA_VERSION) {
    migratedStorage[STORAGE_SCHEMA_VERSION_KEY] = STORAGE_SCHEMA_VERSION;
    changed = true;
  }

  return {
    fromVersion,
    toVersion: STORAGE_SCHEMA_VERSION,
    changed,
    migratedStorage,
  };
}
