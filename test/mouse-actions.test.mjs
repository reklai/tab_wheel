import test from "node:test";
import assert from "node:assert/strict";
import {
  createListenerEvent,
  flushAsyncWork,
  loadTabWheelDomain,
} from "./helpers/domainHarness.mjs";

// Behavioral coverage for the one-shot mouse actions that act on the active
// tab without touching the tab strip: mute toggle and history navigation.
// Runs the real bundled domain against a mutable mock browser window.
async function createActionWorld({ tabs, goBack, goForward }) {
  const passiveEvent = () => createListenerEvent();
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const updates = [];
  const navigations = [];
  const browserMock = {
    runtime: {
      getURL: (path) => path,
      onInstalled: passiveEvent(),
      onStartup: passiveEvent(),
    },
    scripting: { executeScript: async () => {} },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: passiveEvent(),
    },
    tabs: {
      get: async (tabId) => {
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return tab;
      },
      query: async (query) => [...tabsById.values()].filter((tab) =>
        (query.windowId == null || tab.windowId === query.windowId)
        && (query.active == null || tab.active === query.active)),
      sendMessage: async () => ({ scrollX: 0, scrollY: 0 }),
      update: async (tabId, props) => {
        const tab = tabsById.get(tabId);
        updates.push({ tabId, ...props });
        if ("muted" in props) tab.mutedInfo = { muted: props.muted };
        return tab;
      },
      goBack: async (tabId) => {
        navigations.push({ direction: "back", tabId });
        return await goBack(tabId);
      },
      goForward: async (tabId) => {
        navigations.push({ direction: "forward", tabId });
        return await goForward(tabId);
      },
      create: async () => ({}),
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
  const { createTabWheelDomain } = await loadTabWheelDomain(browserMock, async () => {});
  const domain = createTabWheelDomain();
  domain.registerLifecycleListeners();
  await flushAsyncWork();
  return { domain, tabsById, updates, navigations };
}

const activeTab = () => ({ id: 1, windowId: 5, index: 0, active: true, url: "https://page.test/" });

test("mute toggles the active tab's audio each time it runs", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });

  const first = await world.domain.toggleMuteCurrentTab(world.tabsById.get(1));
  const second = await world.domain.toggleMuteCurrentTab(world.tabsById.get(1));

  assert.deepEqual(first, { ok: true, tabId: 1 });
  assert.deepEqual(second, { ok: true, tabId: 1 });
  assert.deepEqual(world.updates, [
    { tabId: 1, muted: true },
    { tabId: 1, muted: false },
  ]);
});

test("mute reads the tab's current muted state rather than remembering its own", async () => {
  const tab = { ...activeTab(), mutedInfo: { muted: true } };
  const world = await createActionWorld({ tabs: [tab], goBack: async () => {}, goForward: async () => {} });

  await world.domain.toggleMuteCurrentTab(world.tabsById.get(1));

  assert.deepEqual(world.updates, [{ tabId: 1, muted: false }]);
});

test("back navigates the active tab's history", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });

  const result = await world.domain.goBackInCurrentTab(world.tabsById.get(1));

  assert.deepEqual(result, { ok: true, tabId: 1 });
  assert.deepEqual(world.navigations, [{ direction: "back", tabId: 1 }]);
});

test("forward navigates the active tab's history", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });

  const result = await world.domain.goForwardInCurrentTab(world.tabsById.get(1));

  assert.deepEqual(result, { ok: true, tabId: 1 });
  assert.deepEqual(world.navigations, [{ direction: "forward", tabId: 1 }]);
});

test("back and forward report a soft failure when the browser has no history entry", async () => {
  const world = await createActionWorld({
    tabs: [activeTab()],
    goBack: async () => { throw new Error("Cannot find a previous page in history."); },
    goForward: async () => { throw new Error("Cannot find a next page in history."); },
  });

  const back = await world.domain.goBackInCurrentTab(world.tabsById.get(1));
  const forward = await world.domain.goForwardInCurrentTab(world.tabsById.get(1));

  assert.deepEqual(back, { ok: false, reason: "Nothing to go back to" });
  assert.deepEqual(forward, { ok: false, reason: "Nothing to go forward to" });
});

test("the actions refuse to run without an active tab", async () => {
  const world = await createActionWorld({
    tabs: [{ ...activeTab(), active: false }],
    goBack: async () => {},
    goForward: async () => {},
  });

  const mute = await world.domain.toggleMuteCurrentTab(undefined, 5);
  const back = await world.domain.goBackInCurrentTab(undefined, 5);
  const forward = await world.domain.goForwardInCurrentTab(undefined, 5);

  for (const result of [mute, back, forward]) {
    assert.deepEqual(result, { ok: false, reason: "No active tab" });
  }
  assert.deepEqual(world.updates, []);
  assert.deepEqual(world.navigations, []);
});
