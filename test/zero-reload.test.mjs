import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");
let domainBundlePromise;
let domainImportSerial = 0;

function createDeferred() {
  let resolveDeferred = () => {};
  const promise = new Promise((resolvePromise) => {
    resolveDeferred = resolvePromise;
  });
  return { promise, resolve: resolveDeferred };
}

function createListenerEvent() {
  let listener;
  return {
    addListener(nextListener) {
      listener = nextListener;
    },
    get listener() {
      return listener;
    },
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function loadTabWheelDomain(browserMock, sleepMock) {
  domainBundlePromise ??= build({
    entryPoints: [resolve(ROOT, "src/lib/backgroundRuntime/domains/tabWheelDomain.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [{
      name: "startup-browser-boundary",
      setup(builder) {
        builder.onResolve(
          { filter: /^webextension-polyfill$/ },
          () => ({ path: "browser-polyfill", namespace: "startup-test" }),
        );
        builder.onLoad(
          { filter: /^browser-polyfill$/, namespace: "startup-test" },
          () => ({
            contents: "export default globalThis.__tabWheelStartupBrowserMock;",
            loader: "js",
          }),
        );
        builder.onResolve(
          { filter: /^\.\.\/\.\.\/common\/utils\/asyncFlow$/ },
          (args) => args.importer.endsWith("tabWheelDomain.ts")
            ? { path: "async-flow", namespace: "startup-test" }
            : null,
        );
        builder.onLoad(
          { filter: /^async-flow$/, namespace: "startup-test" },
          () => ({
            contents: `
              export {
                createInFlightMemo,
                createKeyedTaskQueue,
                createWriteChain,
              } from ${JSON.stringify(resolve(ROOT, "src/lib/common/utils/asyncFlow.ts"))};
              export const sleep = globalThis.__tabWheelStartupSleepMock;
            `,
            loader: "js",
            resolveDir: ROOT,
          }),
        );
      },
    }],
  }).then((result) => result.outputFiles[0].text);

  globalThis.__tabWheelStartupBrowserMock = browserMock;
  globalThis.__tabWheelStartupSleepMock = sleepMock;
  const bundledCode = await domainBundlePromise;
  const encoded = Buffer.from(bundledCode, "utf8").toString("base64");
  domainImportSerial += 1;
  return import(`data:text/javascript;base64,${encoded}#startup-${domainImportSerial}`);
}

async function createStartupHarness({ tabsQuery, executeScript, sleep }) {
  const onStartup = createListenerEvent();
  const passiveEvent = () => createListenerEvent();
  const browserMock = {
    runtime: {
      getURL: (path) => path,
      onInstalled: passiveEvent(),
      onStartup,
    },
    scripting: { executeScript },
    storage: {
      local: {
        get: async () => { throw new Error("skip startup housekeeping in lifecycle test"); },
        remove: async () => {},
        set: async () => {},
      },
      onChanged: passiveEvent(),
    },
    tabs: {
      query: tabsQuery,
      get: async () => null,
      sendMessage: async () => {},
      create: async () => {},
      executeScript: undefined,
      onCreated: passiveEvent(),
      onActivated: passiveEvent(),
      onMoved: passiveEvent(),
      onAttached: passiveEvent(),
      onDetached: passiveEvent(),
      onRemoved: passiveEvent(),
      onUpdated: passiveEvent(),
    },
    windows: {
      getAll: async () => [],
      onRemoved: passiveEvent(),
    },
  };
  const { createTabWheelDomain } = await loadTabWheelDomain(browserMock, sleep);
  createTabWheelDomain().registerLifecycleListeners();
  assert.equal(typeof onStartup.listener, "function", "onStartup handler should be registered");
  return onStartup.listener;
}

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
  assert.match(fnSource, /injectImmediately:\s*true/);
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

test("onStartup isolates a failed initial activation and retries after two seconds", async () => {
  const delay = createDeferred();
  const sleepCalls = [];
  const warnings = [];
  const sequence = [];
  let activationCalls = 0;
  const startupHandler = await createStartupHarness({
    tabsQuery: async () => {
      activationCalls += 1;
      sequence.push(`activation:${activationCalls}`);
      throw new Error(`activation ${activationCalls} failed`);
    },
    executeScript: async () => {},
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
      sequence.push(`sleep:${milliseconds}`);
      await delay.promise;
    },
  });
  const originalWarn = console.warn;
  console.warn = (message) => {
    const warning = String(message);
    warnings.push(warning);
    if (warning.includes("delayed startup content script activation failed")) sequence.push("warning:delayed");
    else if (warning.includes("startup content script activation failed")) sequence.push("warning:initial");
  };
  try {
    const startup = startupHandler();
    await flushAsyncWork();

    assert.equal(activationCalls, 1);
    assert.deepEqual(sleepCalls, [2000]);
    assert.ok(warnings.some((warning) => warning.includes("startup content script activation failed")));
    assert.deepEqual(sequence, ["activation:1", "sleep:2000", "warning:initial"]);

    delay.resolve();
    await startup;

    assert.equal(activationCalls, 2);
    assert.ok(warnings.some((warning) => warning.includes("delayed startup content script activation failed")));
    assert.deepEqual(sequence, [
      "activation:1",
      "sleep:2000",
      "warning:initial",
      "activation:2",
      "warning:delayed",
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test("onStartup schedules its delayed scan while an immediate MV3 injection is still pending", async () => {
  const delay = createDeferred();
  const neverSettles = new Promise(() => {});
  const sleepCalls = [];
  const injectionDetails = [];
  let activationCalls = 0;
  const startupHandler = await createStartupHarness({
    tabsQuery: async () => {
      activationCalls += 1;
      return activationCalls === 1
        ? [{ id: 17, discarded: false, url: "https://example.test/" }]
        : [];
    },
    executeScript: async (details) => {
      injectionDetails.push(details);
      return neverSettles;
    },
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
      await delay.promise;
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    void startupHandler();
    await flushAsyncWork();

    assert.equal(activationCalls, 1);
    assert.deepEqual(sleepCalls, [2000]);
    assert.equal(injectionDetails.length, 1);
    assert.equal(injectionDetails[0].injectImmediately, true);

    delay.resolve();
    await flushAsyncWork();

    assert.equal(activationCalls, 2);
  } finally {
    console.warn = originalWarn;
  }
});

test("wheel cycling lands on a sleeping (discarded) neighbor by activating it, never by injecting into it", async () => {
  const awakeTab = { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" };
  const sleepingTab = { id: 2, windowId: 5, index: 1, active: false, discarded: true, url: "https://asleep.test/" };
  const updatedTabIds = [];
  const injectedTabIds = [];
  const browserMock = {
    runtime: { getURL: (path) => path },
    scripting: {
      executeScript: async ({ target }) => { injectedTabIds.push(target.tabId); },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    tabs: {
      get: async (tabId) => [awakeTab, sleepingTab].find((tab) => tab.id === tabId) ?? null,
      query: async () => [awakeTab, sleepingTab],
      sendMessage: async (tabId) => {
        if (tabId === sleepingTab.id) throw new Error("a discarded tab has no page to receive messages");
        return {};
      },
      update: async (tabId) => {
        updatedTabIds.push(tabId);
        return { ...sleepingTab, active: true };
      },
    },
  };
  const { createTabWheelDomain } = await loadTabWheelDomain(browserMock, async () => {});
  const result = await createTabWheelDomain().cycle("next", "gesture", awakeTab);
  await flushAsyncWork();

  assert.equal(result.ok, true, `cycle should land on the sleeping neighbor, got: ${JSON.stringify(result)}`);
  assert.equal(result.tabId, sleepingTab.id);
  assert.ok(updatedTabIds.includes(sleepingTab.id), "the sleeping tab should be woken by activation");
  assert.ok(!injectedTabIds.includes(sleepingTab.id), "waking must come from activation, not injection");
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
