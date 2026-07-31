import test from "node:test";
import assert from "node:assert/strict";
import {
  createListenerEvent,
  flushAsyncWork,
  loadTabWheelDomain,
} from "./helpers/domainHarness.mjs";

// Behavioral coverage for wheel-cycle semantics: which tabs the wheel may
// land on, and what landing/leaving does to per-tab state. Runs the real
// bundled domain against a mutable mock browser window.
async function createCycleWorld({ tabs, executeScript, sendMessage, sleep }) {
  const passiveEvent = () => createListenerEvent();
  const events = {
    onActivated: createListenerEvent(),
    onUpdated: createListenerEvent(),
  };
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const updatedTabIds = [];
  const sentMessages = [];
  const browserMock = {
    runtime: {
      getURL: (path) => path,
      onInstalled: passiveEvent(),
      onStartup: passiveEvent(),
    },
    scripting: { executeScript },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: passiveEvent(),
    },
    tabs: {
      get: async (tabId) => tabsById.get(tabId) ?? null,
      query: async (query) => [...tabsById.values()].filter((tab) =>
        (query.windowId == null || tab.windowId === query.windowId)
        && (query.active == null || tab.active === query.active)),
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, type: message?.type });
        return await sendMessage(tabId, message);
      },
      update: async (tabId) => {
        for (const tab of tabsById.values()) {
          if (tab.windowId === tabsById.get(tabId)?.windowId) tab.active = tab.id === tabId;
        }
        updatedTabIds.push(tabId);
        events.onActivated.listener?.({ tabId, windowId: tabsById.get(tabId)?.windowId });
        return tabsById.get(tabId);
      },
      create: async () => ({}),
      executeScript: undefined,
      onCreated: passiveEvent(),
      onActivated: events.onActivated,
      onMoved: passiveEvent(),
      onAttached: passiveEvent(),
      onDetached: passiveEvent(),
      onRemoved: passiveEvent(),
      onUpdated: events.onUpdated,
    },
    windows: {
      getAll: async () => [],
      onRemoved: passiveEvent(),
    },
  };
  const { createTabWheelDomain } = await loadTabWheelDomain(browserMock, sleep ?? (async () => {}));
  const domain = createTabWheelDomain();
  domain.registerLifecycleListeners();
  await flushAsyncWork();
  return { domain, events, tabsById, updatedTabIds, sentMessages };
}

test("cycling away from a still-loading woken tab never captures its top-of-page scroll", async () => {
  const world = await createCycleWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" },
      { id: 2, windowId: 5, index: 1, active: false, discarded: true, url: "https://asleep.test/" },
    ],
    executeScript: async () => {},
    sendMessage: async (tabId) => {
      if (tabId === 2) throw new Error("still waking: no receiver yet");
      return { scrollX: 0, scrollY: 0 };
    },
  });

  const landed = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  assert.equal(landed.tabId, 2, "precondition: wheel lands on the sleeping tab");
  await flushAsyncWork();

  // The wake takes longer than any fixed grace period. The load has NOT
  // completed, so leaving the tab must not read (and later store) the
  // top-of-page scroll a waking document reports.
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  try {
    const left = await world.domain.cycle("next", "gesture", world.tabsById.get(2));
    assert.equal(left.tabId, 1, "precondition: wheel wraps back to the awake tab");
    await flushAsyncWork();
  } finally {
    Date.now = realNow;
  }

  const scrollReadsFromWakingTab = world.sentMessages.filter(
    (message) => message.tabId === 2 && message.type === "GET_SCROLL",
  );
  assert.deepEqual(scrollReadsFromWakingTab, [], "no scroll capture while the wake is still in flight");
});

test("cycling lands on a slow awake tab whose script accepts injection but is not ready yet", async () => {
  const injectedTabIds = [];
  const world = await createCycleWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" },
      { id: 2, windowId: 5, index: 1, active: false, url: "https://slow.test/" },
    ],
    executeScript: async ({ target }) => { injectedTabIds.push(target.tabId); },
    sendMessage: async (tabId, message) => {
      // The slow tab accepts injection but its script never announces in time.
      if (tabId === 2 && message?.type === "TABWHEEL_PING") throw new Error("script still starting up");
      return { scrollX: 0, scrollY: 0 };
    },
  });

  const result = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  await flushAsyncWork();

  assert.equal(result.ok, true, `slow is not broken — the wheel must land, got: ${JSON.stringify(result)}`);
  assert.equal(result.tabId, 2);
  assert.ok(injectedTabIds.includes(2), "precondition: the probe did reach injection");
});

test("cycling still skips a tab whose injection the browser refuses", async () => {
  const world = await createCycleWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" },
      { id: 2, windowId: 5, index: 1, active: false, url: "https://blocked.example/viewer.pdf" },
    ],
    executeScript: async ({ target }) => {
      if (target.tabId === 2) throw new Error("Cannot access contents of the page");
    },
    sendMessage: async (tabId, message) => {
      if (tabId === 2 && message?.type === "TABWHEEL_PING") throw new Error("no script can run here");
      return { scrollX: 0, scrollY: 0 };
    },
  });

  const result = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  await flushAsyncWork();

  assert.equal(result.ok, false, "a provably script-refusing page must still be skipped");
  assert.ok(!world.updatedTabIds.includes(2), "the wheel must not visit the refused tab");
});

// A sleeping tab whose URL looks normal can wake into a page that refuses
// content scripts (e.g. the built-in PDF viewer on an https URL). The wheel
// pays one landing there — the same place a native click on that tab would
// leave the user, with the popup fallback as the exit — and afterwards the
// ordinary awake-tab probing takes over and skips it like any restricted page.
test("a sleeping tab that wakes into a script-refusing page is skipped by later cycles", async () => {
  const world = await createCycleWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" },
      { id: 2, windowId: 5, index: 1, active: false, discarded: true, url: "https://files.example/report.pdf" },
    ],
    executeScript: async ({ target }) => {
      if (target.tabId === 2) throw new Error("Cannot access contents of the page");
    },
    sendMessage: async (tabId, message) => {
      if (tabId === 2 && message?.type === "TABWHEEL_PING") throw new Error("no script can run here");
      return { scrollX: 0, scrollY: 0 };
    },
  });

  const landed = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  assert.equal(landed.tabId, 2, "the wheel pays exactly one landing on the unknown sleeping tab");
  await flushAsyncWork();

  const wokenTab = world.tabsById.get(2);
  wokenTab.discarded = false;
  world.events.onUpdated.listener?.(2, { status: "complete" }, wokenTab);
  await flushAsyncWork();

  const escaped = await world.domain.cycle("next", "gesture", world.tabsById.get(2));
  assert.equal(escaped.tabId, 1, "leaving the restricted page cycles normally");
  await flushAsyncWork();

  const retried = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  await flushAsyncWork();

  assert.equal(retried.ok, false, "once proven script-refusing, the tab is skipped like any restricted page");
  const landingsOnRestrictedTab = world.updatedTabIds.filter((tabId) => tabId === 2);
  assert.equal(landingsOnRestrictedTab.length, 1, "the wheel never lands there a second time");
});

test("scroll capture resumes once the woken tab finishes loading", async () => {
  const world = await createCycleWorld({
    tabs: [
      { id: 1, windowId: 5, index: 0, active: true, url: "https://awake.test/" },
      { id: 2, windowId: 5, index: 1, active: false, discarded: true, url: "https://asleep.test/" },
    ],
    executeScript: async () => {},
    sendMessage: async () => ({ scrollX: 0, scrollY: 120 }),
  });

  const landed = await world.domain.cycle("next", "gesture", world.tabsById.get(1));
  assert.equal(landed.tabId, 2, "precondition: wheel lands on the sleeping tab");
  await flushAsyncWork();

  const wokenTab = world.tabsById.get(2);
  wokenTab.discarded = false;
  world.events.onUpdated.listener?.(2, { status: "complete" }, wokenTab);
  await flushAsyncWork();

  await world.domain.cycle("next", "gesture", world.tabsById.get(2));
  await flushAsyncWork();

  const scrollReadsFromWokenTab = world.sentMessages.filter(
    (message) => message.tabId === 2 && message.type === "GET_SCROLL",
  );
  assert.ok(scrollReadsFromWokenTab.length > 0, "capture must resume after the wake completes");
});
