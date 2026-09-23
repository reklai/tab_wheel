// Applies the storage migrations (storageMigrations.ts) to storage.local at
// background startup. A profile already on the current schema, the common
// case, costs one single-key read; only an out-of-date profile has the whole
// storage area read and rewritten.

import browser from "webextension-polyfill";
import {
  createCurrentVersionMigrationResult,
  isStorageSchemaVersionCurrent,
  migrateStorageSnapshot,
  STORAGE_SCHEMA_VERSION_KEY,
  StorageMigrationResult,
} from "./storageMigrations";

/**
 * Brings storage.local to the current schema if needed and reports what ran.
 * Keys the migration dropped are removed before the rest is written back.
 * Rejects if storage cannot be read or written. The background domain awaits
 * this before its first storage read, and still starts if it rejects.
 */
export async function migrateStorageIfNeeded(): Promise<StorageMigrationResult> {
  const versionSnapshot = (await browser.storage.local.get(STORAGE_SCHEMA_VERSION_KEY)) as Record<string, unknown>;
  if (isStorageSchemaVersionCurrent(versionSnapshot[STORAGE_SCHEMA_VERSION_KEY])) {
    return createCurrentVersionMigrationResult();
  }
  // Out of date or never versioned: steps may need to see any key, so read all.
  const snapshot = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const result = migrateStorageSnapshot(snapshot);
  if (!result.changed) return result;
  // set() only adds and overwrites, so keys the steps dropped from the snapshot
  // have to be removed explicitly.
  const deletedKeys = Object.keys(snapshot).filter((key) => !(key in result.migratedStorage));
  if (deletedKeys.length > 0) {
    await browser.storage.local.remove(deletedKeys);
  }
  await browser.storage.local.set(result.migratedStorage);
  return result;
}
