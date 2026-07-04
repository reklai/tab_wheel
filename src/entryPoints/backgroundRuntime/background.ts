// Background entrypoint. Wires up the TabWheel domain, its message handler,
// and the runtime router. Register every listener at the top level — MV3
// service workers only fire events at listeners registered during the first
// run, so nothing below can wait behind an await.

import { createTabWheelDomain } from "../../lib/backgroundRuntime/domains/tabWheelDomain";
import { createTabWheelMessageHandler } from "../../lib/backgroundRuntime/handlers/tabWheelMessageHandler";
import { registerRuntimeMessageRouter } from "../../lib/backgroundRuntime/handlers/runtimeRouter";
import { migrateStorageIfNeeded } from "../../lib/common/utils/storageMigrationsRuntime";

const tabWheel = createTabWheelDomain();
tabWheel.registerLifecycleListeners();

registerRuntimeMessageRouter([
  createTabWheelMessageHandler(tabWheel),
]);

async function bootstrapBackground(): Promise<void> {
  const migration = await migrateStorageIfNeeded();
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
