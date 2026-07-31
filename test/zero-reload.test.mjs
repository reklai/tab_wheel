import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");
const assertOrdered = (text, snippets) => {
  let cursor = -1;
  for (const snippet of snippets) {
    const index = text.indexOf(snippet);
    assert.ok(index > cursor, `${snippet} should follow the previous control`);
    cursor = index;
  }
};

// This suite locks the "zero-reload" promise: installing or updating the
// extension must not require the user to reload their already-open tabs for
// TabWheel to work on them. It asserts the real wiring by string/structure,
// not behavior, so a refactor that silently drops a branch fails CI instead
// of shipping a regression only caught by manual testing.

test("onInstalled reinjects content scripts into already-open tabs on install and update", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const installedHandlerSource = domain.slice(
    domain.indexOf("browser.runtime.onInstalled.addListener"),
  );

  // Protects: "works immediately after install without reloading tabs" — the
  // handler must run for both install and update, and must kick off
  // reinjection into every already-open tab before anything else.
  assertOrdered(installedHandlerSource, [
    'if (details.reason !== "install" && details.reason !== "update") return;',
    "void activateExistingContentScripts()",
    ".then(ensureActiveTabContentScripts)",
  ]);
});

test("executeContentScriptInTab injects via the MV3 scripting API with an MV2 tabs.executeScript fallback", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const fnSource = domain.slice(
    domain.indexOf("async function executeContentScriptInTab"),
    domain.indexOf("async function injectContentScriptIntoTab"),
  );
  assert.ok(fnSource.length > 0, "executeContentScriptInTab should be found in source");

  // Protects: "works immediately after install without reloading tabs" on
  // MV3 browsers (Chrome) — the scripting.executeScript path must exist and
  // target the real content script bundle.
  assert.match(fnSource, /runtimeBrowser\.scripting\?\.executeScript/);
  assert.match(fnSource, /await runtimeBrowser\.scripting\.executeScript\(\{/);
  assert.match(
    fnSource,
    /target:\s*\{\s*tabId,\s*\.\.\.\(allFrames\s*\?\s*\{\s*allFrames:\s*true\s*\}\s*:\s*\{\s*\}\)\s*\}/,
  );
  assert.match(fnSource, /files:\s*\["contentScript\.js"\]/);

  // Protects: the same promise on MV2 browsers (Firefox), where
  // scripting.executeScript does not exist and tabs.executeScript is the
  // only path that can inject into tabs opened before the extension loaded.
  assert.match(fnSource, /if \(runtimeBrowser\.tabs\.executeScript\)/);
  assert.match(fnSource, /await runtimeBrowser\.tabs\.executeScript\(tabId,\s*\{/);
  assert.match(fnSource, /file:\s*"contentScript\.js"/);
  assert.match(
    fnSource,
    /await runtimeBrowser\.tabs\.executeScript\(tabId,\s*\{[\s\S]*?\.\.\.\(allFrames\s*\?\s*\{\s*allFrames:\s*true\s*\}\s*:\s*\{\s*\}\)/,
  );

  const injectFnSource = domain.slice(
    domain.indexOf("async function injectContentScriptIntoTab"),
    domain.indexOf("async function resetState"),
  );
  assertOrdered(injectFnSource, [
    "executeContentScriptInTab(tab.id, true)",
    "executeContentScriptInTab(tab.id, false)",
  ]);
});

test("registerLifecycleListeners primes active tabs on every worker (re)start, not just onInstalled", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const registerFnSource = domain.slice(
    domain.indexOf("function registerLifecycleListeners(): void {"),
    domain.indexOf("\n  return {\n    ensureLoaded,"),
  );
  assert.ok(registerFnSource.length > 0, "registerLifecycleListeners should be found in source");

  // Protects: "works immediately after install without reloading tabs" even
  // when the worker restarts without onInstalled firing (e.g. the extension
  // being re-enabled), which kills page-side listeners without a fresh
  // install/update event to trigger reinjection.
  assert.match(registerFnSource, /void ensureActiveTabContentScripts\(\)\.catch\(\(\) => \{\}\);/);
});

test("onStartup reinjects content scripts into restored tabs without reloading them", () => {
  const domain = readText("src/lib/backgroundRuntime/domains/tabWheelDomain.ts");
  const startupHandlerSource = domain.slice(
    domain.indexOf("browser.runtime.onStartup.addListener"),
    domain.indexOf("\n  return {\n    ensureLoaded,"),
  );
  assert.ok(
    startupHandlerSource.includes("browser.runtime.onStartup.addListener"),
    "onStartup listener should be found in source",
  );

  // Protects: browser cold start reinjects via the install-equivalent path
  // without forced navigation. Await keeps the MV3 worker alive for the scan;
  // inject must not be gated solely on storage housekeeping success.
  assertOrdered(startupHandlerSource, [
    "await ensureLoaded()",
    "await browser.storage.local.remove(TABWHEEL_STORAGE_KEYS.recentTabs)",
    "await activateExistingContentScripts()",
    "await ensureActiveTabContentScripts()",
  ]);
  assert.match(startupHandlerSource, /startup housekeeping failed/);
  assert.match(startupHandlerSource, /await sleep\(2000\)/);
  assert.doesNotMatch(startupHandlerSource, /browser\.tabs\.reload\s*\(/);
});

test("initApp begins execution with the re-injection guard so double injection never stacks listeners", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const initAppSource = app.slice(app.indexOf("export function initApp(): void {"));
  assert.ok(initAppSource.length > 0, "initApp should be found in source");

  const bodyAfterOpenBrace = initAppSource.slice(initAppSource.indexOf("{") + 1);

  // Protects: "works immediately after install without reloading tabs" —
  // background-driven reinjection (manifest injection racing the
  // install-time activateExistingContentScripts pass, or a later refresh)
  // can call initApp more than once in the same document. Running the prior
  // cleanup hook first, before any listener is attached, is what stops
  // wheel/middle-click/scroll listeners from stacking and double-firing.
  assert.match(bodyAfterOpenBrace.trimStart(), /^window\.__tabWheelCleanup\?\.\(\);/);
});
