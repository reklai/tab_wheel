import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("badge adapter feature-detects both action namespaces and reuses the core decision", () => {
  const adapter = readText("src/lib/backgroundRuntime/domains/toolbarBadge.ts");

  assert.match(adapter, /runtimeBrowser\.action/);
  assert.match(adapter, /runtimeBrowser\.browserAction/);
  assert.match(adapter, /import\s*\{\s*resolveToolbarBadge\s*\}\s*from\s*"\.\.\/\.\.\/core\/tabWheel\/restrictedPagesCore"/);

  // No duplicated URL logic: the adapter must lean on the pure decision, not
  // re-derive protocol/hostname checks itself.
  assert.doesNotMatch(adapter, /new URL\(/);
  assert.doesNotMatch(adapter, /\.protocol\s*===/);
  assert.doesNotMatch(adapter, /\.hostname/);
});

test("every badge text call is tab-scoped", () => {
  const adapter = readText("src/lib/backgroundRuntime/domains/toolbarBadge.ts");

  const setBadgeTextCalls = adapter.match(/\.setBadgeText\(\{[^}]*\}\)/g) || [];
  assert.ok(setBadgeTextCalls.length >= 2, "expected both a set and a clear setBadgeText call site");
  for (const call of setBadgeTextCalls) {
    assert.match(call, /tabId/, `setBadgeText call must be tab-scoped: ${call}`);
  }
  // Never a bare/global setBadgeText call with only a text field.
  assert.doesNotMatch(adapter, /setBadgeText\(\{\s*text:\s*[^,}]*\s*\}\)/);
});

test("badge background color is applied once via setBadgeBackgroundColor", () => {
  const adapter = readText("src/lib/backgroundRuntime/domains/toolbarBadge.ts");

  assert.match(adapter, /setBadgeBackgroundColor/);
  assert.match(adapter, /#b45309/);
  assert.match(adapter, /badgeBackgroundColorApplied/);
});

test("clearAllToolbarBadges clears every tracked tab and tolerates gone tabs", () => {
  const adapter = readText("src/lib/backgroundRuntime/domains/toolbarBadge.ts");

  const clearAllBody = adapter.slice(adapter.indexOf("export async function clearAllToolbarBadges"));
  assert.match(clearAllBody, /badgedTabIds\.clear\(\)/);
  assert.match(clearAllBody, /\.catch\(/);
});

test("tabWheelDomain wires badge updates into onActivated, onUpdated, worker start, and tab removal", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");

  assert.match(
    domain,
    /import\s*\{\s*clearAllToolbarBadges,\s*forgetToolbarBadgeTab,\s*updateTabToolbarBadge,\s*\}\s*from\s*"\.\/toolbarBadge"/,
  );

  const onActivatedStart = domain.indexOf("browser.tabs.onActivated.addListener");
  const onMovedStart = domain.indexOf("browser.tabs.onMoved.addListener", onActivatedStart);
  const onActivatedBody = domain.slice(onActivatedStart, onMovedStart);
  assert.ok(onActivatedStart >= 0 && onMovedStart > onActivatedStart);
  assert.match(onActivatedBody, /applyToolbarBadgeForTabId\(activeInfo\.tabId\)/);

  const onRemovedStart = domain.indexOf("browser.tabs.onRemoved.addListener", onMovedStart);
  const onUpdatedStart = domain.indexOf("browser.tabs.onUpdated.addListener", onRemovedStart);
  const tabGroupsApiRegisterStart = domain.indexOf("const tabGroupsApi = getBrowserTabGroupsApi()", onUpdatedStart);
  const onRemovedBody = domain.slice(onRemovedStart, onUpdatedStart);
  const onUpdatedBody = domain.slice(onUpdatedStart, tabGroupsApiRegisterStart);
  assert.ok(onRemovedStart >= 0 && onUpdatedStart > onRemovedStart && tabGroupsApiRegisterStart > onUpdatedStart);
  assert.match(onRemovedBody, /forgetToolbarBadgeTab\(tabId\)/);
  assert.match(onUpdatedBody, /changeInfo\.url\s*\|\|\s*changeInfo\.status === "complete"/);
  assert.match(onUpdatedBody, /applyToolbarBadgeForTab\(updatedTab\)/);

  const storageChangedStart = domain.indexOf("browser.storage.onChanged.addListener");
  const onCreatedStart = domain.indexOf("browser.tabs.onCreated.addListener", storageChangedStart);
  const storageChangedBody = domain.slice(storageChangedStart, onCreatedStart);
  assert.ok(storageChangedStart >= 0 && onCreatedStart > storageChangedStart);
  assert.match(storageChangedBody, /showRestrictedBadge\s*&&\s*!nextSettings\.showRestrictedBadge/);
  assert.match(storageChangedBody, /clearAllToolbarBadges\(\)/);
  assert.match(storageChangedBody, /!previousSettings\.showRestrictedBadge\s*&&\s*nextSettings\.showRestrictedBadge/);
  assert.match(storageChangedBody, /applyToolbarBadgeForActiveTabs\(\)/);

  const ensureActiveTabContentScriptsBody = domain.slice(
    domain.indexOf("async function ensureActiveTabContentScripts"),
    domain.indexOf("async function ensureContentScriptForActiveTab"),
  );
  assert.match(ensureActiveTabContentScriptsBody, /applyToolbarBadgeForTab\(activeTab\)/);
  // The badge prime must run before the restricted/discarded early-return, or
  // restricted tabs would never get a badge on worker start.
  const primeIndex = ensureActiveTabContentScriptsBody.indexOf("applyToolbarBadgeForTab(activeTab)");
  const restrictedReturnIndex = ensureActiveTabContentScriptsBody.indexOf(
    "isPageGestureRestrictedUrl(activeTab.url) || activeTab.discarded === true",
  );
  assert.ok(primeIndex >= 0 && restrictedReturnIndex >= 0 && primeIndex < restrictedReturnIndex);

  // updateTabToolbarBadge is fed settings.showRestrictedBadge from the same
  // getSettings() cache the rest of the domain already reads through.
  assert.match(domain, /updateTabToolbarBadge\(tab\.id, tab\.url, settings\.showRestrictedBadge\)/);
});
