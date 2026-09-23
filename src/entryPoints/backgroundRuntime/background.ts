// Background service worker entry. It wires the TabWheel domain (tab state,
// cycling, drag, badge) to the single runtime message router and starts the
// storage migration.
//
// Every listener is registered synchronously at the top level, before any
// await: an MV3 service worker only dispatches the waking event to listeners
// that exist when the worker script finishes its first run.

import { createTabWheelDomain } from "../../lib/backgroundRuntime/domains/tabWheelDomain";
import { createTabWheelMessageHandler } from "../../lib/backgroundRuntime/handlers/tabWheelMessageHandler";
import { registerRuntimeMessageRouter } from "../../lib/backgroundRuntime/handlers/runtimeRouter";
import { migrateStorageIfNeeded } from "../../lib/common/utils/storageMigrationsRuntime";

// The domain awaits this promise before its first storage read, so it never
// observes a pre-migration shape even though listeners are live immediately.
const migrationReady = migrateStorageIfNeeded();
const tabWheel = createTabWheelDomain({ migrationReady });
tabWheel.registerLifecycleListeners();

registerRuntimeMessageRouter([
  createTabWheelMessageHandler(tabWheel),
]);

/**
 * Finishes startup after listeners are in place: logs a migration if one ran
 * and warms the domain's in-memory state so the first gesture does not pay
 * for the storage load.
 */
async function bootstrapBackground(): Promise<void> {
  const migration = await migrationReady;
  if (migration.changed) {
    console.log(
      `[TabWheel] Storage migration applied (${migration.fromVersion} -> ${migration.toVersion}).`,
    );
  }

  void tabWheel.ensureLoaded();
}

void bootstrapBackground().catch((error) => {
  console.error("[TabWheel] Background bootstrap failed:", error);
});
