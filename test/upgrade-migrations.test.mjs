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


// The shared device profile is deliberately NOT a settings key: it is
// evidence, so it must survive every upgrade untouched (no fixture or schema
// bump is involved) and must equally survive "reset to defaults", which clears
// preferences only. This locks the passthrough that makes both true.
test("migrations carry the device profile through untouched", async () => {
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const source = readFileSync(resolve(root, "src/lib/common/utils/storageMigrations.ts"), "utf8");
  const transformed = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  const migrations = await import(`data:text/javascript;base64,${encoded}`);

  const deviceProfile = { kind: "discreteWheel", notchMagnitudePx: 48, updatedAtMs: 1 };
  const result = migrations.migrateStorageSnapshot({
    storageSchemaVersion: 12,
    tabWheelSettings: { wheelSensitivity: 1 },
    tabWheelDeviceProfile: deviceProfile,
  });

  assert.deepEqual(result.migratedStorage.tabWheelDeviceProfile, deviceProfile);
  assert.equal(result.toVersion, migrations.STORAGE_SCHEMA_VERSION);
});
