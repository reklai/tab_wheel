import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

test("verifyUpgrade script succeeds on fixture snapshots", () => {
  const result = spawnSync(process.execPath, [resolve(root, "esBuildConfig/verifyUpgrade.mjs")], {
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `verifyUpgrade failed:\nstdout:\n${result.stdout || "(empty)"}\nstderr:\n${result.stderr || "(empty)"}`,
  );
});


// The device classifier is gone, so the evidence it wrote is not carried
// forward: leaving the key behind would strand an orphan record of the user's
// hardware in local storage forever. The fixtures cover the v15 hop; this
// covers an old snapshot arriving from well below the step, where the key
// predates several intermediate migrations.
test("migrations delete the retired device profile and auto-tune preference", async () => {
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const source = readFileSync(resolve(root, "src/lib/common/utils/storageMigrations.ts"), "utf8");
  const transformed = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  const migrations = await import(`data:text/javascript;base64,${encoded}`);

  const result = migrations.migrateStorageSnapshot({
    storageSchemaVersion: 12,
    tabWheelSettings: { wheelSensitivity: 1, deviceAwareTuning: false },
    tabWheelDeviceProfile: { kind: "discreteWheel", notchMagnitudePx: 48, updatedAtMs: 1 },
  });

  const hasKey = (target, key) => Object.prototype.hasOwnProperty.call(target, key);
  assert.equal(hasKey(result.migratedStorage, "tabWheelDeviceProfile"), false);
  // An explicit opt-out is removed too, not just the default-valued key: the
  // setting no longer exists, so leaving either value behind is stale state.
  assert.equal(hasKey(result.migratedStorage.tabWheelSettings, "deviceAwareTuning"), false);
  assert.equal(result.changed, true);
  assert.equal(result.toVersion, migrations.STORAGE_SCHEMA_VERSION);
});

test("v19 preserves native-new-tab mappings", async () => {
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const source = readFileSync(resolve(root, "src/lib/common/utils/storageMigrations.ts"), "utf8");
  const transformed = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  const migrations = await import(`data:text/javascript;base64,${encoded}`);

  const result = migrations.migrateStorageSnapshot({
    storageSchemaVersion: 18,
    tabWheelSettings: {
      leftClickAction: "nativeNewTab",
      middleClickAction: "nativeNewTab",
      rightClickAction: "none",
    },
  });

  assert.deepEqual(result.migratedStorage.tabWheelSettings, {
    leftClickAction: "nativeNewTab",
    middleClickAction: "nativeNewTab",
    rightClickAction: "none",
  });
  assert.equal(result.migratedStorage.storageSchemaVersion, 19);
  assert.equal(result.changed, true);
});

test("historical migrations preserve a valid middle-click mapping", async () => {
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const source = readFileSync(resolve(root, "src/lib/common/utils/storageMigrations.ts"), "utf8");
  const transformed = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  const migrations = await import(`data:text/javascript;base64,${encoded}`);

  const result = migrations.migrateStorageSnapshot({
    storageSchemaVersion: 12,
    tabWheelSettings: {
      middleClickAction: "recentTab",
    },
  });

  assert.equal(result.migratedStorage.tabWheelSettings.middleClickAction, "recentTab");
});

test("v18 click-action restoration preserves drag-current-tab mappings", async () => {
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const source = readFileSync(resolve(root, "src/lib/common/utils/storageMigrations.ts"), "utf8");
  const transformed = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  const migrations = await import(`data:text/javascript;base64,${encoded}`);

  const result = migrations.migrateStorageSnapshot({
    storageSchemaVersion: 17,
    tabWheelSettings: {
      leftClickAction: "dragCurrentTab",
      middleClickAction: "recentTab",
      rightClickAction: "closeToRecent",
    },
  });

  assert.equal(result.migratedStorage.tabWheelSettings.leftClickAction, "dragCurrentTab");
  assert.equal(result.migratedStorage.storageSchemaVersion, 19);
});
