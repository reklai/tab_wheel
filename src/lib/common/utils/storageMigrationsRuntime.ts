// Applies the storage schema migration at background startup. Reads only the
// version key first — an already-migrated profile skips the full storage
// snapshot. The pure migration steps live in storageMigrations.ts.

import browser from "webextension-polyfill";
import {
  createCurrentVersionMigrationResult,
  isStorageSchemaVersionCurrent,
  migrateStorageSnapshot,
  STORAGE_SCHEMA_VERSION_KEY,
  StorageMigrationResult,
} from "./storageMigrations";

export async function migrateStorageIfNeeded(): Promise<StorageMigrationResult> {
  const versionSnapshot = (await browser.storage.local.get(STORAGE_SCHEMA_VERSION_KEY)) as Record<string, unknown>;
  if (isStorageSchemaVersionCurrent(versionSnapshot[STORAGE_SCHEMA_VERSION_KEY])) {
    return createCurrentVersionMigrationResult();
  }
  const snapshot = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const result = migrateStorageSnapshot(snapshot);
  if (!result.changed) return result;
  const deletedKeys = Object.keys(snapshot).filter((key) => !(key in result.migratedStorage));
  if (deletedKeys.length > 0) {
    await browser.storage.local.remove(deletedKeys);
  }
  await browser.storage.local.set(result.migratedStorage);
  return result;
}
