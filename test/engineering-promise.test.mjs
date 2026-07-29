import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("the product promise is focused and local-only", () => {
  const readme = readText("README.md");
  const store = readText("STORE.md");
  const privacy = readText("PRIVACY.md");

  assert.match(readme, /one job/i);
  assert.match(readme, /Alt\s*\/\s*Option \+ (?:mouse )?wheel/i);
  assert.match(store, /No data is sent to TabWheel/);
  assert.match(privacy, /does not collect, transmit, or share/i);
  assert.doesNotMatch(`${readme}\n${store}`, /feature-rich promise/i);
});

test("runtime keeps gesture, serialized cycling, and scroll restore mechanisms explicit", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");

  assert.match(app, /isTabWheelModifier/);
  assert.match(app, /cycleTabWheel\(direction,\s*"gesture"\)/);
  assert.match(app, /applyScrollRestoreAttempt/);
  assert.match(domain, /runSerializedWindowTask/);
  assert.match(domain, /const candidateTabs = eligibleTabs;/);
  assert.match(domain, /getRecentCandidateTabs/);
  assert.doesNotMatch(domain, /cycleScope|MruCycleSession/);
  assert.match(domain, /scrollRestoreTokensByTabId/);
  assert.match(domain, /restorePagePosition/);
});

test("package scripts expose the full engineering guardrail chain", () => {
  const scripts = JSON.parse(readText("package.json")).scripts;
  for (const command of [
    "npm run lint",
    "npm run test",
    "npm run typecheck",
    "npm run verify:compat",
    "npm run verify:upgrade",
    "npm run verify:store",
    "npm run build:firefox",
    "npm run build:chrome",
  ]) {
    assert.ok(scripts.ci.includes(command), `ci should include ${command}`);
  }
});
