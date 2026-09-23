// Storage schema migrations, as pure functions over a snapshot of
// storage.local. storageMigrationsRuntime.ts does the reading and writing.
//
// storage.local records its schema version under STORAGE_SCHEMA_VERSION_KEY;
// a missing or invalid value reads as 0, a profile from before versioning.
// migrateStorageSnapshot runs every step newer than that version, oldest
// first, then stamps STORAGE_SCHEMA_VERSION. The block guarded by
// `fromVersion < N` upgrades a profile to version N, and steps are cumulative:
// a v3 profile runs every step from v4 on, in order. A fresh install skips the
// steps, having nothing to upgrade, and a version newer than this build's is
// left alone so running an older build never rewrites storage it does not
// understand.
//
// Each step is frozen once released. Steps use key names, value lists, and
// defaults written as literals in this file rather than imported from the live
// contracts, so renaming or reshaping a live setting never changes how old
// storage is upgraded or cleaned up. A schema change adds a new step and bumps
// STORAGE_SCHEMA_VERSION; it never edits an old step.

/** The storage.local key that holds the schema version number. */
export const STORAGE_SCHEMA_VERSION_KEY = "storageSchemaVersion";
const TABWHEEL_SETTINGS_KEY = "tabWheelSettings";
const TABWHEEL_SCROLL_MEMORY_KEY = "tabWheelScrollMemory";
// The most-recently-used tab list, which also drove an MRU cycle mode. v18
// moved it to TABWHEEL_RECENT_TABS_KEY.
const TABWHEEL_MRU_STATE_KEY = "tabWheelMruState";
const TABWHEEL_RECENT_TABS_KEY = "tabWheelRecentTabs";
// Keys of retired features: the search launcher's history, the tab-tagging
// system, the saved wheel list, and the device profile behind auto-tuning.
const TABWHEEL_SEARCH_HISTORY_KEY = "tabWheelSearchHistory";
const TABWHEEL_LEGACY_TAGGED_TABS_KEY = "tabWheelTaggedTabs";
const TABWHEEL_WHEEL_LIST_KEY = "tabWheelWheelList";
const TABWHEEL_DEVICE_PROFILE_KEY = "tabWheelDeviceProfile";
/**
 * The schema this build writes. v19 has no step of its own: it only restamps
 * the version, leaving a v18 profile's contents as they are.
 */
export const STORAGE_SCHEMA_VERSION = 19;

type StorageSnapshot = Record<string, unknown>;

/** What a migration did. */
export interface StorageMigrationResult {
  /** The stored schema version before migrating (0 when unversioned). */
  fromVersion: number;
  toVersion: number;
  /** Whether storage must be written back. False means nothing to do. */
  changed: boolean;
  /**
   * The complete storage contents after migrating. Keys absent here but
   * present before are meant to be deleted. Empty when no migration ran.
   */
  migratedStorage: StorageSnapshot;
}

// The stored version as a whole number, or 0 when missing or invalid.
function readSchemaVersion(storage: StorageSnapshot): number {
  const numeric = Number(storage[STORAGE_SCHEMA_VERSION_KEY]);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : 0;
}

// Nothing stored yet except, at most, a version number.
function isFreshInstallSnapshot(storage: StorageSnapshot): boolean {
  const keys = Object.keys(storage);
  return keys.length === 0 || keys.every((key) => key === STORAGE_SCHEMA_VERSION_KEY);
}

/** True when `rawVersion`, as read from storage, is this build's schema. */
export function isStorageSchemaVersionCurrent(rawVersion: unknown): boolean {
  return Number(rawVersion) === STORAGE_SCHEMA_VERSION;
}

/** The result for storage already on the current schema: nothing to write. */
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

// Deletes `key` if present; true when something was deleted.
function deleteKey(storage: StorageSnapshot, key: string): boolean {
  if (!hasKey(storage, key)) return false;
  delete storage[key];
  return true;
}

// v5 turns gestures on inside editable fields (inputs, textareas, rich text).
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

// Deletes one field from the stored settings object, if both exist.
function deleteSettingKey(storage: StorageSnapshot, key: string): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return false;
  const nextSettings = { ...(settings as Record<string, unknown>) };
  if (!deleteKey(nextSettings, key)) return false;
  storage[TABWHEEL_SETTINGS_KEY] = nextSettings;
  return true;
}

// Backfills the settings introduced between v8 and v11, with the defaults of
// that time, and drops the retired search URL template and cycle order. v8,
// v9, and v11 each run it as fields were added; it only fills what is missing,
// so a repeat run is harmless.
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

// The union of every click action that has ever been valid, deliberately
// wider than any single step's set (v18's excludes "search"). Steps that
// check against it keep any historically valid mapping; a value retired later
// is remapped by the frozen step that retired it.
const TABWHEEL_CLICK_ACTION_VALUES = [
  "search",
  "nativeNewTab",
  "recentTab",
  "closeToRecent",
  "duplicateTab",
  "dragCurrentTab",
  "openSettings",
  "muteTab",
  "goBack",
  "goForward",
  "none",
];

function isClickActionValue(value: unknown): boolean {
  return typeof value === "string" && TABWHEEL_CLICK_ACTION_VALUES.includes(value);
}

// v13 introduces per-button click actions, filling any missing mapping with
// that release's defaults. The left button's default follows the old
// openNativeNewTabOnLeftClick flag, which is then removed.
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

// v14 is the 3.0 focused release: left and right click actions and the
// page-scroll controls are removed, the middle button keeps its action, and
// settings that became internal reliability rules are forced on.
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

  if (!isClickActionValue(nextSettings.middleClickAction)) {
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

// v15 backfills the device auto-tune preference and the restricted-page badge,
// both on by default.
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
// preference and the profile key it wrote. The frozen v15 step still adds the
// preference on the way through, and this step removes it again, so no
// snapshot older than 16 keeps it. Nothing replaces the profile.
function removeDeviceTuningState(storage: StorageSnapshot): boolean {
  let changed = deleteSettingKey(storage, "deviceAwareTuning");
  changed = deleteKey(storage, TABWHEEL_DEVICE_PROFILE_KEY) || changed;
  return changed;
}

// v17 turns wrapAround into a normal user setting (see normalizeTabWheelSettings)
// and introduces cycleWithinTabGroup. wrapAround needs no backfill of its own:
// an absent key already normalizes to true by default (tabWheel.ts), the same
// value the old force-true rule produced, so every upgrading profile keeps
// its effective behavior either way. Only the newly introduced key does.
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

// v18 restores remappable click actions on all three buttons, with that
// release's defaults, and retires the MRU wheel-cycle mode. The MRU list is
// kept but moves to the recent-tabs key, since it now serves only the
// recent-tab click actions.
function restoreClickActionsAndRetireMruCycle(storage: StorageSnapshot): boolean {
  const settings = storage[TABWHEEL_SETTINGS_KEY];
  const hasExistingSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
  const nextSettings = hasExistingSettings ? { ...(settings as Record<string, unknown>) } : {};
  const validActions = new Set([
    "nativeNewTab",
    "recentTab",
    "closeToRecent",
    "duplicateTab",
    "dragCurrentTab",
    "openSettings",
    "none",
  ]);
  let changed = !hasExistingSettings;

  const defaults: ReadonlyArray<[string, string]> = [
    ["leftClickAction", "nativeNewTab"],
    ["middleClickAction", "recentTab"],
    ["rightClickAction", "closeToRecent"],
  ];
  for (const [key, fallback] of defaults) {
    if (validActions.has(String(nextSettings[key]))) continue;
    nextSettings[key] = fallback;
    changed = true;
  }
  if (deleteKey(nextSettings, "cycleScope")) changed = true;
  if (changed) storage[TABWHEEL_SETTINGS_KEY] = nextSettings;

  if (!hasKey(storage, TABWHEEL_RECENT_TABS_KEY) && hasKey(storage, TABWHEEL_MRU_STATE_KEY)) {
    storage[TABWHEEL_RECENT_TABS_KEY] = storage[TABWHEEL_MRU_STATE_KEY];
    changed = true;
  }
  changed = deleteKey(storage, TABWHEEL_MRU_STATE_KEY) || changed;
  return changed;
}

// True for a parseable http(s) URL string.
function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

// v7: scroll positions are restored by page URL, so entries that are not
// objects or lack an http(s) URL are dropped.
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

// v10 drops the per-entry zoom level the retired zoom-restore feature saved.
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

/**
 * Upgrades a snapshot of the whole storage area to STORAGE_SCHEMA_VERSION.
 * `input` is not modified. See the file header for the ordering rules.
 */
export function migrateStorageSnapshot(input: StorageSnapshot): StorageMigrationResult {
  const migratedStorage: StorageSnapshot = { ...input };
  const fromVersion = readSchemaVersion(input);

  // Written by a newer build: leave it untouched rather than downgrade it.
  if (fromVersion > STORAGE_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: fromVersion,
      changed: false,
      migratedStorage,
    };
  }

  // A fresh install has nothing to upgrade; it only needs the version stamp.
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
  // Profiles at v2 or earlier drop the old frecency data.
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
  // The retired toast-on-every-switch setting.
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
  // The retired search launcher's URL template.
  if (fromVersion < 12) {
    changed = deleteSettingKey(migratedStorage, "searchUrlTemplate") || changed;
  }
  if (fromVersion < 13) {
    changed = migrateClickActionSettings(migratedStorage) || changed;
  }
  if (fromVersion < 14) {
    changed = focusTabWheelSettings(migratedStorage) || changed;
    // The 3.0 release also retired the search launcher and its history.
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
  if (fromVersion < 18) {
    changed = restoreClickActionsAndRetireMruCycle(migratedStorage) || changed;
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
