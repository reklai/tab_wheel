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
async function createActionWorld({ tabs, goBack, goForward, sendMessage }) {
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
      sendMessage: async (tabId, message) => {
        if (sendMessage) await sendMessage(tabId, message);
        return { scrollX: 0, scrollY: 0 };
      },
      update: async (tabId, props) => {
        const tab = tabsById.get(tabId);
        if (tab?.refuseUpdate) throw new Error("Tab cannot be updated");
        updates.push({ tabId, ...props });
        if ("muted" in props) tab.mutedInfo = { muted: props.muted };
        if ("pinned" in props) tab.pinned = props.pinned;
        return tab;
      },
      reload: async (tabId) => {
        if (tabsById.get(tabId)?.refuseUpdate) throw new Error("Tab cannot be reloaded");
        navigations.push({ direction: "reload", tabId });
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
    assert.deepEqual(result, { ok: false, reason: "Couldn't find the current tab" });
  }
  assert.deepEqual(world.updates, []);
  assert.deepEqual(world.navigations, []);
});

test("mute reports a soft failure when the browser refuses the update", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });
  world.tabsById.get(1).refuseUpdate = true;

  const result = await world.domain.toggleMuteCurrentTab(world.tabsById.get(1));

  assert.deepEqual(result, { ok: false, reason: "This tab can't be muted" });
});

test("pin toggles the active tab's pinned state each time it runs", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });

  const first = await world.domain.togglePinCurrentTab(world.tabsById.get(1));
  const second = await world.domain.togglePinCurrentTab(world.tabsById.get(1));

  assert.deepEqual(first, { ok: true, tabId: 1 });
  assert.deepEqual(second, { ok: true, tabId: 1 });
  assert.deepEqual(world.updates, [
    { tabId: 1, pinned: true },
    { tabId: 1, pinned: false },
  ]);
});

test("reload reloads the active tab", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });

  const result = await world.domain.reloadCurrentTab(world.tabsById.get(1));

  assert.deepEqual(result, { ok: true, tabId: 1 });
  assert.deepEqual(world.navigations, [{ direction: "reload", tabId: 1 }]);
});

test("pin and reload report a soft failure when the browser refuses", async () => {
  const world = await createActionWorld({ tabs: [activeTab()], goBack: async () => {}, goForward: async () => {} });
  world.tabsById.get(1).refuseUpdate = true;

  assert.deepEqual(
    await world.domain.togglePinCurrentTab(world.tabsById.get(1)),
    { ok: false, reason: "This tab can't be pinned" },
  );
  assert.deepEqual(
    await world.domain.reloadCurrentTab(world.tabsById.get(1)),
    { ok: false, reason: "Couldn't reload this tab" },
  );
});

test("a swipe hand-off is relayed to the tab now active in the sender's window", async () => {
  const sent = [];
  const world = await createActionWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: false, url: "https://page.test/a" },
      { id: 2, windowId: 5, index: 1, active: true, url: "https://page.test/b" },
    ],
    goBack: async () => {},
    goForward: async () => {},
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); },
  });

  const result = await world.domain.handOffSwipe(world.tabsById.get(1), 42, "y");

  assert.deepEqual(result, { ok: true, tabId: 2 });
  assert.deepEqual(sent, [{ tabId: 2, message: { type: "TABWHEEL_SWIPE_CARRY", remainderPx: 42, axis: "y" } }]);
});

test("a swipe hand-off goes nowhere when the sender is still the active tab", async () => {
  const sent = [];
  const world = await createActionWorld({
    tabs: [activeTab()],
    goBack: async () => {},
    goForward: async () => {},
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); },
  });

  assert.deepEqual(await world.domain.handOffSwipe(world.tabsById.get(1), 42, "y"), { ok: true });
  assert.deepEqual(await world.domain.handOffSwipe(world.tabsById.get(1), Number.NaN, "y"), { ok: false });
  assert.deepEqual(sent, []);
});

test("a swipe hand-off with an axis that is not x, y or null is not relayed", async () => {
  const sent = [];
  const world = await createActionWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: false, url: "https://page.test/a" },
      { id: 2, windowId: 5, index: 1, active: true, url: "https://page.test/b" },
    ],
    goBack: async () => {},
    goForward: async () => {},
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); },
  });

  assert.deepEqual(await world.domain.handOffSwipe(world.tabsById.get(1), 42, "z"), { ok: false });
  assert.deepEqual(sent, []);
});
