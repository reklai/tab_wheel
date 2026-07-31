// The background worker owns browser state and may restart at any time. Treat
// maps below as per-worker caches; only settings, onboarding state, recent-tab
// and scroll memory survive through storage.

import browser, { Tabs } from "webextension-polyfill";
import {
  loadTabWheelOnboardingState,
  loadTabWheelSettings,
  MAX_RECENT_TABS,
  MAX_SCROLL_MEMORY_ENTRIES,
  normalizeTabWheelSettings,
  saveTabWheelOnboardingState,
  TABWHEEL_STORAGE_KEYS,
} from "../../common/contracts/tabWheel";
import { resolveCycleTargetIndex } from "../../core/tabWheel/tabWheelCore";
import {
  resolveMovedTabResult,
  resolveTabDragTargetIndex,
} from "../../core/tabWheel/tabDragCore";
import {
  isPageGestureRestrictedUrl,
  normalizePageUrl,
} from "../../core/tabWheel/restrictedPagesCore";
import {
  createInFlightMemo,
  createKeyedTaskQueue,
  createWriteChain,
  sleep,
} from "../../common/utils/asyncFlow";
import {
  forgetToolbarBadgeTab,
  updateTabToolbarBadge,
} from "./toolbarBadge";

type ScrollMemoryByTabId = Record<string, TabWheelScrollMemoryEntry>;
type RecentTabIdsByWindowId = TabWheelRecentTabState;

interface BrowserTabGroup {
  id: number;
  collapsed: boolean;
  windowId: number;
}

interface BrowserTabGroupEvent {
  addListener(listener: (group: BrowserTabGroup) => void): void;
}

interface BrowserTabGroupsApi {
  query(queryInfo: {
    windowId?: number;
    collapsed?: boolean;
  }): Promise<BrowserTabGroup[]>;
  onCreated?: BrowserTabGroupEvent;
  onRemoved?: BrowserTabGroupEvent;
  onUpdated?: BrowserTabGroupEvent;
}

interface ExistingTabActivationResult {
  attempted: number;
  injected: number;
  skipped: number;
  failed: number;
}

interface WindowTabsCacheEntry {
  tabs: Tabs.Tab[];
  expiresAt: number;
}

interface ActivateTabOptions {
  restoreScrollAsync?: boolean;
}

interface EnsurePageGestureProbeOptions {
  // Speculative callers pass false (see warmNeighborReadiness). A failed probe
  // then costs nothing but time, instead of narrowing the user's next cycle.
  recordFailure?: boolean;
}

interface ContentScriptUnavailableEntry {
  url: string;
  expiresAt: number;
}

interface DiscardedTabWakeHold {
  tabId: number;
  expiresAt: number;
}

interface BackgroundTabDragSession {
  gestureId: string;
  tabId: number;
  windowId: number;
  ready: Promise<void>;
  release: () => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export interface TabWheelDomain {
  ensureLoaded(): Promise<void>;
  activateExistingContentScripts(): Promise<ExistingTabActivationResult>;
  getOverview(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelOverview>;
  cycle(
    direction: "prev" | "next",
    source: TabWheelCycleSource,
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult>;
  openNativeNewTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  activateMostRecentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  closeCurrentTabAndActivateRecent(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  duplicateTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  beginTabDrag(gestureId: string, tab?: Tabs.Tab): Promise<TabWheelActionResult>;
  moveCurrentTab(direction: TabWheelMoveDirection, tab?: Tabs.Tab, gestureId?: string): Promise<TabWheelMoveResult>;
  endTabDrag(gestureId: string, tab?: Tabs.Tab): Promise<TabWheelActionResult>;
  waitForTabDrag(tab?: Tabs.Tab): Promise<void>;
  refreshCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelRefreshResult>;
  resetState(): Promise<TabWheelActionResult>;
  saveScrollPosition(tabId: number, windowId: number, url: string | undefined, scroll: ScrollData): Promise<TabWheelActionResult>;
  markContentScriptReady(tab?: Tabs.Tab): TabWheelActionResult;
  registerLifecycleListeners(): void;
}

const FALLBACK_CYCLE_LOCK_WINDOW_ID = 0;
const LEGACY_RECENT_TABS_STORAGE_KEY = "tabWheelMruState";
const WINDOW_TABS_CACHE_TTL_MS = 350;
const SCROLL_MEMORY_SAVE_DEBOUNCE_MS = 120;
const GESTURE_TARGET_PROBE_TIMEOUT_MS = 320;
const MAX_GESTURE_PROBE_ATTEMPTS = 4;
// How far the post-switch pre-probe looks in each cycle direction. Two covers
// the tabs a continued gesture reaches within the next couple of cooldowns
// (which is what the 320ms hot-path probe is currently paid for), while
// keeping the speculative work per switch bounded at four tabs.
const NEIGHBOR_PREPROBE_DEPTH = 2;
const CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS = 2500;
// A speculative probe deliberately does not write the negative cache, so it
// needs its own way to not retry a tab that just failed. Mirrors the negative
// cache's window so the retry cadence is unchanged; the difference is only
// that this one is invisible to cycle eligibility.
const NEIGHBOR_PREPROBE_RETRY_COOLDOWN_MS = CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS;
const GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS = [0, 80, 180] as const;
const SCROLL_RESTORE_RETRY_DELAYS_MS = [0, 80, 220, 500, 900, 1500, 2400, 3600] as const;
const DISCARDED_SCROLL_RESTORE_RETRY_DELAYS_MS = [...SCROLL_RESTORE_RETRY_DELAYS_MS, 4000] as const;
const DISCARDED_WAKE_CYCLE_HOLD_MS = 700;
const TAB_DRAG_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

function windowKey(windowId: number): string {
  return String(windowId);
}

function tabKey(tabId: number): string {
  return String(tabId);
}

async function resolveWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const guardedTask = task.catch(() => fallback);
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([guardedTask, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeScroll(scrollX: number, scrollY: number): { scrollX: number; scrollY: number } {
  return {
    scrollX: Math.max(0, Number(scrollX) || 0),
    scrollY: Math.max(0, Number(scrollY) || 0),
  };
}

function normalizeScrollRatio(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeScrollDimension(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function normalizeScrollData(value: Partial<ScrollData>): ScrollData {
  const scroll = normalizeScroll(Number(value.scrollX), Number(value.scrollY));
  const scrollWidth = normalizeScrollDimension(value.scrollWidth);
  const scrollHeight = normalizeScrollDimension(value.scrollHeight);
  const viewportWidth = normalizeScrollDimension(value.viewportWidth);
  const viewportHeight = normalizeScrollDimension(value.viewportHeight);
  const maxScrollX = Math.max(0, scrollWidth - viewportWidth);
  const maxScrollY = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollX: scroll.scrollX,
    scrollY: scroll.scrollY,
    scrollRatioX: value.scrollRatioX == null
      ? maxScrollX > 0 ? Math.max(0, Math.min(1, scroll.scrollX / maxScrollX)) : 0
      : normalizeScrollRatio(value.scrollRatioX),
    scrollRatioY: value.scrollRatioY == null
      ? maxScrollY > 0 ? Math.max(0, Math.min(1, scroll.scrollY / maxScrollY)) : 0
      : normalizeScrollRatio(value.scrollRatioY),
    scrollWidth,
    scrollHeight,
    viewportWidth,
    viewportHeight,
  };
}

function normalizeScrollMemoryEntry(rawEntry: unknown): TabWheelScrollMemoryEntry | null {
  if (typeof rawEntry !== "object" || rawEntry === null) return null;
  const entry = rawEntry as Partial<TabWheelScrollMemoryEntry>;
  const tabId = Number(entry.tabId);
  const windowId = Number(entry.windowId);
  const url = normalizePageUrl(entry.url);
  if (!Number.isInteger(tabId) || tabId <= 0) return null;
  if (!Number.isInteger(windowId) || windowId <= 0) return null;
  if (!url) return null;
  const scroll = normalizeScrollData(entry);
  return {
    tabId,
    windowId,
    url,
    scrollX: scroll.scrollX,
    scrollY: scroll.scrollY,
    scrollRatioX: scroll.scrollRatioX,
    scrollRatioY: scroll.scrollRatioY,
    scrollWidth: scroll.scrollWidth,
    scrollHeight: scroll.scrollHeight,
    viewportWidth: scroll.viewportWidth,
    viewportHeight: scroll.viewportHeight,
    updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : Date.now(),
  };
}

function normalizeScrollMemory(rawValue: unknown): ScrollMemoryByTabId {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) return {};
  const normalized: ScrollMemoryByTabId = {};
  for (const [key, rawEntry] of Object.entries(rawValue as Record<string, unknown>)) {
    const entry = normalizeScrollMemoryEntry(rawEntry);
    if (!entry || key !== tabKey(entry.tabId)) continue;
    normalized[key] = entry;
  }
  return normalized;
}

function trimScrollMemory(memory: ScrollMemoryByTabId): ScrollMemoryByTabId {
  const entries = Object.values(memory)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SCROLL_MEMORY_ENTRIES);
  return Object.fromEntries(entries.map((entry) => [tabKey(entry.tabId), entry]));
}

function normalizeRecentTabState(rawValue: unknown): RecentTabIdsByWindowId {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) return {};
  const normalized: RecentTabIdsByWindowId = {};
  for (const [key, rawTabIds] of Object.entries(rawValue as Record<string, unknown>)) {
    const windowId = Number(key);
    if (!Number.isInteger(windowId) || windowId <= 0 || !Array.isArray(rawTabIds)) continue;
    const seenTabIds = new Set<number>();
    const tabIds = rawTabIds
      .map((value) => Number(value))
      .filter((tabId) => {
        if (!Number.isInteger(tabId) || tabId <= 0 || seenTabIds.has(tabId)) return false;
        seenTabIds.add(tabId);
        return true;
      })
      .slice(0, MAX_RECENT_TABS);
    if (tabIds.length > 0) normalized[key] = tabIds;
  }
  return normalized;
}

function buildScrollMemoryEntry(
  tabId: number,
  windowId: number,
  url: string,
  scroll: ScrollData,
): TabWheelScrollMemoryEntry {
  return {
    tabId,
    windowId,
    url,
    scrollX: scroll.scrollX,
    scrollY: scroll.scrollY,
    scrollRatioX: scroll.scrollRatioX,
    scrollRatioY: scroll.scrollRatioY,
    scrollWidth: scroll.scrollWidth,
    scrollHeight: scroll.scrollHeight,
    viewportWidth: scroll.viewportWidth,
    viewportHeight: scroll.viewportHeight,
    updatedAt: Date.now(),
  };
}

function getTabIndex(tab: Tabs.Tab): number {
  return Number(tab.index) || 0;
}

function isRestrictedTab(tab: Tabs.Tab): boolean {
  return isPageGestureRestrictedUrl(tab.url);
}

function getBrowserTabGroupsApi(): Partial<BrowserTabGroupsApi> | null {
  return (browser as unknown as { tabGroups?: Partial<BrowserTabGroupsApi> }).tabGroups ?? null;
}

function isCollapsedGroupTab(tab: Tabs.Tab, collapsedTabGroupIds: ReadonlySet<number>): boolean {
  return tab.groupId != null && collapsedTabGroupIds.has(tab.groupId);
}

// Ungrouped tabs (groupId -1, or undefined on browsers with no tabGroups
// support) all normalize to the same implicit group, so a browser without
// group support never has more than one group and the filter below is a
// no-op there — a graceful degrade rather than a special case.
function normalizeTabGroupId(groupId: number | undefined): number {
  return groupId ?? -1;
}

function getEligibleTabs(
  tabs: Tabs.Tab[],
  settings: TabWheelSettings,
  collapsedTabGroupIds: ReadonlySet<number> = new Set(),
  // Required, not optional: null means "no active tab to compare against" and
  // must skip the predicate rather than silently narrowing to ungrouped-only
  // tabs, which is what an omitted argument would otherwise produce.
  activeTabGroupId: number | null,
): Tabs.Tab[] {
  return tabs
    .filter((tab) => tab.id != null
      && (!settings.skipPinnedTabs || tab.pinned !== true)
      && (!settings.skipHiddenTabs || (tab.hidden !== true && !isCollapsedGroupTab(tab, collapsedTabGroupIds)))
      && (!settings.skipRestrictedPages || !isRestrictedTab(tab))
      && (!settings.cycleWithinTabGroup
        || activeTabGroupId == null
        || normalizeTabGroupId(tab.groupId) === activeTabGroupId))
    .sort((left, right) => getTabIndex(left) - getTabIndex(right));
}

function hasSameNumberList(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createTabWheelDomain(options: {
  migrationReady?: Promise<unknown>;
} = {}): TabWheelDomain {
  const migrationReady = options.migrationReady ?? Promise.resolve();
  let scrollMemoryByTabId: ScrollMemoryByTabId = {};
  let recentTabIdsByWindowId: RecentTabIdsByWindowId = {};
  const windowTabsCacheByWindowId = new Map<number, WindowTabsCacheEntry>();
  const collapsedTabGroupIdsCacheByWindowId = new Map<number, {
    collapsedTabGroupIds: Set<number>;
    expiresAt: number;
  }>();
  const contentScriptReadyUrlsByTabId = new Map<number, string>();
  const windowGestureTaskQueue = createKeyedTaskQueue();
  const tabDragSessionsById = new Map<string, BackgroundTabDragSession>();
  const tabDragTailsByWindowId = new Map<number, Promise<void>>();
  const recentTabStateWriteChain = createWriteChain();
  const activeTabIdsByWindowId = new Map<number, number>();
  const scrollRestoreTokensByTabId = new Map<number, number>();
  const contentScriptUnavailableUrlsByTabId = new Map<number, ContentScriptUnavailableEntry>();
  const neighborWarmupTabIds = new Set<number>();
  const neighborPreprobedUntilByTabId = new Map<number, number>();
  const neighborWarmupGenerationByWindowId = new Map<number, number>();
  const discardedWakeHoldByWindowId = new Map<number, DiscardedTabWakeHold>();
  let scrollRestoreSerial = 0;
  let scrollMemorySaveTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollMemorySaveResolvers: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  let scrollMemoryWriteChain: Promise<void> = Promise.resolve();
  let settingsCache: TabWheelSettings | null = null;

  const ensureLoaded = createInFlightMemo(async () => {
    await migrationReady.catch(() => {});
    const stored = await browser.storage.local.get([
      TABWHEEL_STORAGE_KEYS.scrollMemory,
      TABWHEEL_STORAGE_KEYS.recentTabs,
      LEGACY_RECENT_TABS_STORAGE_KEY,
    ]);
    scrollMemoryByTabId = normalizeScrollMemory(
      stored[TABWHEEL_STORAGE_KEYS.scrollMemory],
    );
    recentTabIdsByWindowId = normalizeRecentTabState(
      stored[TABWHEEL_STORAGE_KEYS.recentTabs] ?? stored[LEGACY_RECENT_TABS_STORAGE_KEY],
    );
  });

  async function getSettings(): Promise<TabWheelSettings> {
    if (settingsCache) return settingsCache;
    settingsCache = await loadTabWheelSettings();
    return settingsCache;
  }

  function updateSettingsCache(value: unknown): void {
    settingsCache = normalizeTabWheelSettings(value);
  }

  async function persistScrollMemory(): Promise<void> {
    scrollMemoryByTabId = trimScrollMemory(scrollMemoryByTabId);
    await browser.storage.local.set({
      [TABWHEEL_STORAGE_KEYS.scrollMemory]: scrollMemoryByTabId,
    });
  }

  function flushScrollMemorySave(): Promise<void> {
    if (scrollMemorySaveTimer) {
      clearTimeout(scrollMemorySaveTimer);
      scrollMemorySaveTimer = null;
    }
    const resolvers = scrollMemorySaveResolvers;
    scrollMemorySaveResolvers = [];
    if (resolvers.length === 0) return scrollMemoryWriteChain.catch(() => {});

    scrollMemoryWriteChain = scrollMemoryWriteChain
      .catch(() => {})
      .then(() => persistScrollMemory());
    scrollMemoryWriteChain
      .then(() => {
        for (const pending of resolvers) pending.resolve();
      })
      .catch((error: unknown) => {
        for (const pending of resolvers) pending.reject(error);
      });
    return scrollMemoryWriteChain;
  }

  function saveScrollMemory(): Promise<void> {
    const pendingSave = new Promise<void>((resolve, reject) => {
      scrollMemorySaveResolvers.push({ resolve, reject });
    });
    if (scrollMemorySaveTimer) clearTimeout(scrollMemorySaveTimer);
    scrollMemorySaveTimer = setTimeout(() => {
      scrollMemorySaveTimer = null;
      void flushScrollMemorySave().catch(() => {});
    }, SCROLL_MEMORY_SAVE_DEBOUNCE_MS);
    return pendingSave;
  }

  function saveRecentTabState(): Promise<void> {
    return recentTabStateWriteChain.enqueue(() => browser.storage.local.set({
      [TABWHEEL_STORAGE_KEYS.recentTabs]: recentTabIdsByWindowId,
    }));
  }

  function queryTabsSafe(queryInfo: Tabs.QueryQueryInfoType): Promise<Tabs.Tab[] | null> {
    return browser.tabs.query(queryInfo).catch(() => null);
  }

  async function queryActiveTab(windowId?: number): Promise<Tabs.Tab | null> {
    const [activeTab] = await queryTabsSafe(
      windowId != null ? { active: true, windowId } : { active: true, currentWindow: true },
    ) ?? [];
    return activeTab?.id != null && activeTab.windowId != null ? activeTab : null;
  }

  async function resolveActiveTab(tab?: Tabs.Tab, windowId?: number): Promise<Tabs.Tab | null> {
    const fallbackWindowId = windowId ?? tab?.windowId;
    if (tab?.id != null && tab.windowId != null) {
      try {
        const currentTab = await browser.tabs.get(tab.id);
        if (currentTab?.id != null && currentTab.windowId != null && currentTab.active === true) {
          return currentTab;
        }
        return await queryActiveTab(currentTab?.windowId ?? fallbackWindowId);
      } catch (_) {
        return await queryActiveTab(fallbackWindowId);
      }
    }
    return await queryActiveTab(windowId);
  }

  async function resolveCurrentWindowId(windowId?: number): Promise<number | null> {
    if (windowId != null) return windowId;
    const [activeTab] = await queryTabsSafe({ active: true, currentWindow: true }) ?? [];
    return activeTab?.windowId ?? null;
  }

  function invalidateWindowTabsCache(windowId: number | undefined): void {
    if (windowId == null) {
      windowTabsCacheByWindowId.clear();
      collapsedTabGroupIdsCacheByWindowId.clear();
      return;
    }
    windowTabsCacheByWindowId.delete(windowId);
    collapsedTabGroupIdsCacheByWindowId.delete(windowId);
  }

  async function getWindowTabs(windowId: number): Promise<Tabs.Tab[]> {
    const cached = windowTabsCacheByWindowId.get(windowId);
    if (cached && cached.expiresAt > Date.now()) return cached.tabs;
    const tabs = await queryTabsSafe({ windowId });
    if (!tabs) return [];
    windowTabsCacheByWindowId.set(windowId, {
      tabs,
      expiresAt: Date.now() + WINDOW_TABS_CACHE_TTL_MS,
    });
    return tabs;
  }

  function markContentScriptAvailable(tab: Tabs.Tab, url: string): void {
    if (tab.id == null) return;
    contentScriptReadyUrlsByTabId.set(tab.id, url);
    contentScriptUnavailableUrlsByTabId.delete(tab.id);
  }

  function markContentScriptUnavailable(
    tab: Tabs.Tab,
    ttlMs = CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS,
  ): void {
    if (tab.id == null) return;
    contentScriptReadyUrlsByTabId.delete(tab.id);
    const url = normalizePageUrl(tab.url);
    if (!url) return;
    contentScriptUnavailableUrlsByTabId.set(tab.id, {
      url,
      expiresAt: Date.now() + ttlMs,
    });
  }

  function isContentScriptKnownUnavailable(tab: Tabs.Tab): boolean {
    if (tab.id == null) return false;
    const url = normalizePageUrl(tab.url);
    const entry = contentScriptUnavailableUrlsByTabId.get(tab.id);
    if (!url || !entry || entry.url !== url) return false;
    if (entry.expiresAt > Date.now()) return true;
    contentScriptUnavailableUrlsByTabId.delete(tab.id);
    return false;
  }

  async function getCollapsedTabGroupIds(
    windowId: number,
    tabs: Tabs.Tab[],
    settings: TabWheelSettings,
  ): Promise<Set<number>> {
    if (!settings.skipHiddenTabs) return new Set();
    if (!tabs.some((tab) => tab.groupId != null && tab.groupId !== -1)) return new Set();
    const cached = collapsedTabGroupIdsCacheByWindowId.get(windowId);
    if (cached && cached.expiresAt > Date.now()) return cached.collapsedTabGroupIds;
    const tabGroupsApi = getBrowserTabGroupsApi();
    if (typeof tabGroupsApi?.query !== "function") return new Set();
    const collapsedGroups = await tabGroupsApi
      .query({ windowId, collapsed: true })
      .catch(() => []);
    const collapsedTabGroupIds = new Set(
      collapsedGroups
        .filter((group) => group.collapsed === true && Number.isInteger(group.id))
        .map((group) => group.id),
    );
    collapsedTabGroupIdsCacheByWindowId.set(windowId, {
      collapsedTabGroupIds,
      expiresAt: Date.now() + WINDOW_TABS_CACHE_TTL_MS,
    });
    return collapsedTabGroupIds;
  }

  async function getGestureEligibleTabs(
    tabs: Tabs.Tab[],
    settings: TabWheelSettings,
    windowId: number,
    activeTab: Tabs.Tab | null,
  ): Promise<Tabs.Tab[]> {
    const collapsedTabGroupIds = await getCollapsedTabGroupIds(windowId, tabs, settings);
    const eligibleTabs = getEligibleTabs(
      tabs,
      settings,
      collapsedTabGroupIds,
      activeTab ? activeTab.groupId ?? -1 : null,
    );
    return settings.skipRestrictedPages
      ? eligibleTabs.filter((tab) => !isContentScriptKnownUnavailable(tab))
      : eligibleTabs;
  }

  function beginScrollRestore(tabId: number): number {
    const token = ++scrollRestoreSerial;
    scrollRestoreTokensByTabId.set(tabId, token);
    return token;
  }

  function cancelScrollRestore(tabId: number | undefined): void {
    if (tabId == null) return;
    scrollRestoreTokensByTabId.set(tabId, ++scrollRestoreSerial);
  }

  function isScrollRestoreCurrent(tabId: number, token: number): boolean {
    return scrollRestoreTokensByTabId.get(tabId) === token;
  }

  function getActiveDiscardedWakeHold(windowId: number, activeTabId: number): DiscardedTabWakeHold | null {
    const hold = discardedWakeHoldByWindowId.get(windowId);
    if (!hold) return null;
    if (hold.tabId !== activeTabId || hold.expiresAt <= Date.now()) {
      discardedWakeHoldByWindowId.delete(windowId);
      return null;
    }
    return hold;
  }

  function setDiscardedWakeHold(tab: Tabs.Tab): void {
    if (tab.id == null || tab.windowId == null || tab.discarded !== true) return;
    discardedWakeHoldByWindowId.set(tab.windowId, {
      tabId: tab.id,
      expiresAt: Date.now() + DISCARDED_WAKE_CYCLE_HOLD_MS,
    });
  }

  function clearDiscardedWakeHoldForTab(tabId: number): void {
    for (const [windowId, hold] of discardedWakeHoldByWindowId) {
      if (hold.tabId === tabId) discardedWakeHoldByWindowId.delete(windowId);
    }
  }

  async function reconcileRecentTabs(windowId: number, tabs: Tabs.Tab[]): Promise<void> {
    await ensureLoaded();
    const key = windowKey(windowId);
    const tabIds = new Set(tabs.map((tab) => tab.id).filter((tabId): tabId is number => tabId != null));
    const current = recentTabIdsByWindowId[key] || [];
    const next = current.filter((tabId) => tabIds.has(tabId)).slice(0, MAX_RECENT_TABS);
    if (hasSameNumberList(current, next)) return;
    if (next.length > 0) recentTabIdsByWindowId[key] = next;
    else delete recentTabIdsByWindowId[key];
    await saveRecentTabState();
  }

  // Recent-tab state is advisory. A storage failure should not block a gesture.
  async function recordRecentTab(tabId: number, windowId: number): Promise<void> {
    try {
      await ensureLoaded();
      if (!Number.isInteger(tabId) || tabId <= 0 || !Number.isInteger(windowId) || windowId <= 0) return;
      const key = windowKey(windowId);
      const current = recentTabIdsByWindowId[key] || [];
      const next = [tabId, ...current.filter((candidate) => candidate !== tabId)].slice(0, MAX_RECENT_TABS);
      if (hasSameNumberList(current, next)) return;
      recentTabIdsByWindowId[key] = next;
      await saveRecentTabState();
    } catch (error) {
      console.warn("[TabWheel] Recent-tab recording failed:", error);
    }
  }

  async function executeContentScriptInTab(tabId: number, allFrames: boolean): Promise<boolean> {
    const runtimeBrowser = browser as typeof browser & {
      scripting?: {
        executeScript(details: {
          target: { tabId: number; allFrames?: boolean };
          files: string[];
          injectImmediately?: boolean;
        }): Promise<unknown>;
      };
      tabs: typeof browser.tabs & {
        executeScript?: (tabId: number, details: { file: string; runAt?: string; allFrames?: boolean }) => Promise<unknown>;
      };
    };

    try {
      if (runtimeBrowser.scripting?.executeScript) {
        await runtimeBrowser.scripting.executeScript({
          target: { tabId, ...(allFrames ? { allFrames: true } : {}) },
          files: ["contentScript.js"],
          // Restored documents may never reach the default document_idle phase.
          injectImmediately: true,
        });
        return true;
      }
      if (runtimeBrowser.tabs.executeScript) {
        await runtimeBrowser.tabs.executeScript(tabId, {
          file: "contentScript.js",
          runAt: "document_start",
          ...(allFrames ? { allFrames: true } : {}),
        });
        return true;
      }
    } catch (_) {
      return false;
    }

    return false;
  }

  async function injectContentScriptIntoTab(tab: Tabs.Tab): Promise<"injected" | "skipped" | "failed"> {
    if (tab.id == null || tab.discarded === true || isPageGestureRestrictedUrl(tab.url)) return "skipped";

    // Try all frames first so already-open pages match manifest injection as
    // closely as possible.
    if (await executeContentScriptInTab(tab.id, true)) return "injected";

    // Chrome can fail the all-frame call because of one restricted subframe. The
    // top frame is enough for page-level gestures, so fall back to that.
    return await executeContentScriptInTab(tab.id, false) ? "injected" : "failed";
  }

  // Reset keeps onboarding completion so restoring settings does not reopen the
  // first-run coach, but clears all behavior and position state.
  async function resetState(): Promise<TabWheelActionResult> {
    await ensureLoaded();
    recentTabIdsByWindowId = {};
    scrollMemoryByTabId = {};
    updateSettingsCache(undefined);
    await browser.storage.local.remove([
      TABWHEEL_STORAGE_KEYS.settings,
      TABWHEEL_STORAGE_KEYS.recentTabs,
      TABWHEEL_STORAGE_KEYS.scrollMemory,
    ]).catch(() => {});
    return { ok: true };
  }

  async function activateExistingContentScripts(): Promise<ExistingTabActivationResult> {
    const result: ExistingTabActivationResult = {
      attempted: 0,
      injected: 0,
      skipped: 0,
      failed: 0,
    };
    const tabs = await browser.tabs.query({});

    await Promise.all(tabs.map(async (tab) => {
      const activation = await injectContentScriptIntoTab(tab);
      if (activation === "skipped") {
        result.skipped += 1;
        return;
      }
      result.attempted += 1;
      if (activation === "injected") result.injected += 1;
      else result.failed += 1;
    }));

    return result;
  }

  // Badge decisions use only the cheap pure URL check (resolveToolbarBadge via
  // updateTabToolbarBadge) — never gated behind content-script probing, so tab
  // switching stays cheap.
  async function applyToolbarBadgeForTab(tab: Tabs.Tab | null | undefined): Promise<void> {
    if (tab?.id == null) return;
    const settings = await getSettings();
    await updateTabToolbarBadge(tab.id, tab.url, settings.showRestrictedBadge);
  }

  async function applyToolbarBadgeForTabId(tabId: number): Promise<void> {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    await applyToolbarBadgeForTab(tab);
  }

  async function ensureActiveTabContentScripts(): Promise<void> {
    const windows = await browser.windows.getAll().catch(() => []);
    await Promise.all(windows.map(async (win) => {
      if (win.id == null) return;
      const [activeTab] = await browser.tabs.query({ active: true, windowId: win.id }).catch(() => []);
      if (!activeTab || activeTab.id == null) return;
      // Prime the badge for every active tab (including restricted ones) each
      // time the worker/event page (re)starts, before the content-script path
      // below early-returns on restricted or discarded tabs.
      void applyToolbarBadgeForTab(activeTab).catch(() => {});
      if (isPageGestureRestrictedUrl(activeTab.url) || activeTab.discarded === true) return;
      if (contentScriptReadyUrlsByTabId.get(activeTab.id) === normalizePageUrl(activeTab.url)) return;
      if (await pingContentScript(activeTab)) return;
      const injection = await injectContentScriptIntoTab(activeTab);
      if (injection !== "injected") return;
      await waitForContentScriptReady(activeTab, GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS);
    }));
  }

  async function ensureContentScriptForActiveTab(tabId: number): Promise<void> {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab || tab.id == null) return;
    if (isPageGestureRestrictedUrl(tab.url) || tab.discarded === true) return;
    if (contentScriptReadyUrlsByTabId.get(tab.id) === normalizePageUrl(tab.url)) return;
    if (await pingContentScript(tab)) return;
    const injection = await injectContentScriptIntoTab(tab);
    if (injection !== "injected") return;
    await resolveWithTimeout(
      waitForContentScriptReady(tab, GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS),
      GESTURE_TARGET_PROBE_TIMEOUT_MS,
      false,
    ).catch(() => {});
  }

  async function pingContentScript(tab: Tabs.Tab): Promise<boolean> {
    if (tab.id == null) return false;
    const url = normalizePageUrl(tab.url);
    if (!url) return false;
    try {
      await browser.tabs.sendMessage(tab.id, { type: "TABWHEEL_PING" });
      markContentScriptAvailable(tab, url);
      return true;
    } catch (_) {
      contentScriptReadyUrlsByTabId.delete(tab.id);
      return false;
    }
  }

  async function waitForContentScriptReady(
    tab: Tabs.Tab,
    retryDelaysMs: readonly number[] = [0, 90, 240, 450, 800],
  ): Promise<boolean> {
    for (const delay of retryDelaysMs) {
      if (delay > 0) await sleep(delay);
      if (await pingContentScript(tab)) return true;
    }
    return false;
  }

  async function getScroll(tabId: number): Promise<ScrollData | null> {
    try {
      return (await browser.tabs.sendMessage(tabId, { type: "GET_SCROLL" })) as ScrollData;
    } catch (_) {
      return null;
    }
  }

  async function resolveContentScriptStatus(tab: Tabs.Tab | null): Promise<TabWheelContentScriptStatus> {
    if (!tab?.id) return "unavailable";
    if (isPageGestureRestrictedUrl(tab.url)) return "unavailable";
    if (isContentScriptKnownUnavailable(tab)) return "unavailable";
    const url = normalizePageUrl(tab.url);
    if (!url) return "unavailable";
    if (contentScriptReadyUrlsByTabId.get(tab.id) === url) return "ready";

    return await pingContentScript(tab) ? "ready" : "unavailable";
  }

  // Also the MV3 worker pre-warm target (see appInit's wheelHandler), which is
  // why it is chosen: it returns without awaiting anything. Keep it that way
  // and keep its side effects to seeding the readiness caches — the recent-tab touch
  // below is deliberately detached and a no-op for an already-current tab —
  // or every gesture chord starts paying for whatever gets added here.
  function markContentScriptReady(tab?: Tabs.Tab): TabWheelActionResult {
    if (!tab?.id) return { ok: false, reason: "No sender tab" };
    if (isPageGestureRestrictedUrl(tab.url)) return { ok: false, reason: "Unsupported page" };
    const url = normalizePageUrl(tab.url);
    if (!url) return { ok: false, reason: "Unsupported page" };
    markContentScriptAvailable(tab, url);
    if (tab.active === true && tab.windowId != null) {
      activeTabIdsByWindowId.set(tab.windowId, tab.id);
      void recordRecentTab(tab.id, tab.windowId);
    }
    return { ok: true };
  }

  // recordFailure writes the negative cache, and that cache feeds
  // getGestureEligibleTabs — so it does not merely remember a slow tab, it
  // removes the tab from what the next cycle can reach. Only a caller
  // resolving a switch the user actually asked for has earned that: probing
  // *injects*, injection is itself what wakes a frozen or throttled tab, and
  // so a 320ms timeout is frequently a tab the probe just made usable rather
  // than evidence of one that is broken.
  async function ensurePageGestureAvailable(
    tab: Tabs.Tab,
    { recordFailure = true }: EnsurePageGestureProbeOptions = {},
  ): Promise<boolean> {
    if (tab.id == null) return false;
    const tabId = tab.id;
    if (isPageGestureRestrictedUrl(tab.url)) {
      if (recordFailure) markContentScriptUnavailable(tab);
      return false;
    }
    const url = normalizePageUrl(tab.url);
    if (!url) return false;
    if (contentScriptReadyUrlsByTabId.get(tab.id) === url) {
      contentScriptUnavailableUrlsByTabId.delete(tab.id);
      return true;
    }
    const didBecomeReady = await resolveWithTimeout(
      (async () => {
        if (await pingContentScript(tab)) return true;
        const injection = await injectContentScriptIntoTab(tab);
        if (injection !== "injected") return false;
        const currentTab = await browser.tabs.get(tabId).catch(() => tab);
        return await waitForContentScriptReady(currentTab, GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS);
      })(),
      GESTURE_TARGET_PROBE_TIMEOUT_MS,
      false,
    );
    if (didBecomeReady) return true;

    if (recordFailure) markContentScriptUnavailable(tab);
    return false;
  }

  async function restoreScroll(tab: Tabs.Tab): Promise<boolean> {
    if (tab.id == null) return false;
    const settings = await getSettings();
    if (!settings.restorePagePosition) return false;
    const retryDelaysMs = tab.discarded === true
      ? DISCARDED_SCROLL_RESTORE_RETRY_DELAYS_MS
      : SCROLL_RESTORE_RETRY_DELAYS_MS;
    const restoreToken = beginScrollRestore(tab.id);
    const entry = scrollMemoryByTabId[tabKey(tab.id)];
    const currentUrl = normalizePageUrl(tab.url);
    if (!currentUrl || entry?.url !== currentUrl) return false;
    if (!entry) return false;
    for (const delay of retryDelaysMs) {
      if (!isScrollRestoreCurrent(tab.id, restoreToken)) return false;
      if (delay > 0) await sleep(delay);
      if (!isScrollRestoreCurrent(tab.id, restoreToken)) return false;
      try {
        await browser.tabs.sendMessage(tab.id, {
          type: "SET_SCROLL",
          scrollX: entry.scrollX,
          scrollY: entry.scrollY,
          scrollRatioX: entry.scrollRatioX,
          scrollRatioY: entry.scrollRatioY,
          scrollWidth: entry.scrollWidth,
          scrollHeight: entry.scrollHeight,
          viewportWidth: entry.viewportWidth,
          viewportHeight: entry.viewportHeight,
        });
        return true;
      } catch (_) {
        // Loading tabs can reject until the content script is ready. Keep the
        // scheduled retries, unless a newer restore token supersedes this one.
      }
    }
    return false;
  }

  async function captureTabScroll(tab: Tabs.Tab): Promise<void> {
    if (tab.id == null || tab.windowId == null) return;
    const url = normalizePageUrl(tab.url);
    if (!url) return;
    const scroll = await getScroll(tab.id);
    if (!scroll) return;
    const normalized = normalizeScrollData(scroll);
    scrollMemoryByTabId[tabKey(tab.id)] = buildScrollMemoryEntry(tab.id, tab.windowId, url, normalized);
    await saveScrollMemory();
  }

  // A discarded tab can report top-of-page while waking. Preserve the old scroll
  // entry until the wake/restore cycle has settled.
  function captureTabScrollUnlessWaking(tab: Tabs.Tab, settings: TabWheelSettings): void {
    if (!settings.restorePagePosition) return;
    if (tab.id == null || tab.windowId == null) return;
    if (getActiveDiscardedWakeHold(tab.windowId, tab.id)) return;
    void captureTabScroll(tab).catch(() => {});
  }

  async function getOverview(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelOverview> {
    await ensureLoaded();
    const settings = await getSettings();
    const onboarding = await loadTabWheelOnboardingState();
    const resolvedWindowId = await resolveCurrentWindowId(windowId ?? tab?.windowId);
    if (resolvedWindowId == null) {
      return {
        activeIndex: 0,
        tabCount: 0,
        contentScriptStatus: "unavailable",
        firstGestureCycleCompleted: onboarding.firstGestureCycleCompleted,
      };
    }
    const activeTab = await resolveActiveTab(tab, resolvedWindowId);
    const tabs = await getWindowTabs(resolvedWindowId);
    await reconcileRecentTabs(resolvedWindowId, tabs);
    const eligibleTabs = await getGestureEligibleTabs(tabs, settings, resolvedWindowId, activeTab);
    const activeIndex = activeTab
      ? eligibleTabs.findIndex((candidate) => candidate.id === activeTab.id)
      : -1;
    const contentScriptStatus = await resolveContentScriptStatus(activeTab);
    return {
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      ...(activeTab?.id != null ? { activeTabId: activeTab.id } : {}),
      tabCount: eligibleTabs.length,
      contentScriptStatus,
      firstGestureCycleCompleted: onboarding.firstGestureCycleCompleted,
    };
  }

  function resolveStripTargetTab(
    activeTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    direction: "prev" | "next",
    wrapAround: boolean,
  ): Tabs.Tab | null {
    const targetIndex = resolveCycleTargetIndex(
      candidateTabs.map(getTabIndex),
      getTabIndex(activeTab),
      direction,
      wrapAround,
    );
    return candidateTabs.find((tab) => getTabIndex(tab) === targetIndex) || null;
  }

  function resolveCycleTargetTab(
    activeTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    direction: "prev" | "next",
    settings: TabWheelSettings,
  ): Tabs.Tab | null {
    return resolveStripTargetTab(activeTab, candidateTabs, direction, settings.wrapAround);
  }

  async function resolveAvailableCycleTargetTab(
    activeTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    direction: "prev" | "next",
    settings: TabWheelSettings,
  ): Promise<Tabs.Tab | null> {
    let remainingTabs = candidateTabs;
    const maxAttempts = Math.min(candidateTabs.length, MAX_GESTURE_PROBE_ATTEMPTS);
    for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
      const targetTab = resolveCycleTargetTab(activeTab, remainingTabs, direction, settings);
      if (!targetTab?.id || targetTab.id === activeTab.id) return null;
      if (!settings.skipRestrictedPages || await ensurePageGestureAvailable(targetTab)) return targetTab;
      remainingTabs = remainingTabs.filter((candidate) => candidate.id !== targetTab.id);
    }
    // Do not activate an unprobed restricted-page candidate. Failed probes are
    // cached, so the next gesture tick will skip them cheaply.
    return null;
  }

  // Walks the cycle's own target resolution outward from the tab just
  // activated, so pre-probing inherits the exact tab-strip and wrap-around
  // semantics the next real gesture will use instead of
  // re-deriving them. Stops on a repeat: both resolvers hand back the tab they
  // were given once a non-wrapping cycle reaches the edge, and a wrapping
  // cycle in a short list comes back around to somewhere already collected.
  function collectNeighborCandidateTabs(
    originTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    settings: TabWheelSettings,
  ): Tabs.Tab[] {
    const neighborTabs: Tabs.Tab[] = [];
    const seenTabIds = new Set<number>();
    if (originTab.id != null) seenTabIds.add(originTab.id);
    for (const direction of ["next", "prev"] as const) {
      let cursorTab = originTab;
      for (let step = 0; step < NEIGHBOR_PREPROBE_DEPTH; step += 1) {
        const neighborTab = resolveCycleTargetTab(cursorTab, candidateTabs, direction, settings);
        if (neighborTab?.id == null || seenTabIds.has(neighborTab.id)) break;
        seenTabIds.add(neighborTab.id);
        neighborTabs.push(neighborTab);
        cursorTab = neighborTab;
      }
    }
    return neighborTabs;
  }

  // Supersede, don't drop: per-chain sequentiality alone does not bound
  // fan-out, because one chain is spawned per switch. At the detented 100ms
  // cooldown a burst can leave ~10 chains alive on a cold window, which
  // collectively is the injection stampede sequential probing exists to
  // prevent. The newest neighborhood is the most predictive of where the user
  // is heading, so a newer chain retires the older ones instead of being
  // dropped in favor of them. Same token shape as beginScrollRestore above.
  function beginNeighborWarmupGeneration(windowId: number): number {
    const generation = (neighborWarmupGenerationByWindowId.get(windowId) ?? 0) + 1;
    neighborWarmupGenerationByWindowId.set(windowId, generation);
    return generation;
  }

  function isNeighborWarmupCurrent(windowId: number, generation: number): boolean {
    return neighborWarmupGenerationByWindowId.get(windowId) === generation;
  }

  function isNeighborRecentlyPreprobed(tabId: number): boolean {
    const expiresAt = neighborPreprobedUntilByTabId.get(tabId);
    if (expiresAt == null) return false;
    if (expiresAt > Date.now()) return true;
    neighborPreprobedUntilByTabId.delete(tabId);
    return false;
  }

  // Probing injects a content script, so a discarded tab is never a candidate:
  // the browser unloaded it to reclaim memory, and speculative work has no
  // right to spend the user's memory waking a tab they may never switch to.
  // Only a real switch may do that. Tabs the caches have already answered for
  // (ready, or known unavailable) are skipped too — the next cycle reads those
  // answers without probing, so there is nothing left to warm.
  function shouldWarmNeighborTab(tab: Tabs.Tab): boolean {
    if (tab.id == null || tab.discarded === true) return false;
    if (neighborWarmupTabIds.has(tab.id)) return false;
    if (isNeighborRecentlyPreprobed(tab.id)) return false;
    if (isContentScriptKnownUnavailable(tab)) return false;
    const url = normalizePageUrl(tab.url);
    if (!url) return false;
    return contentScriptReadyUrlsByTabId.get(tab.id) !== url;
  }

  // Fire-and-forget speculation that pays down the 320ms-per-candidate probe
  // the next gesture would otherwise pay in its hot path, before tabs.update.
  // It is never awaited by the cycle that spawns it (see cycleUnlocked), so
  // neither the cycle's response nor the serialized window queue waits on it.
  //
  // The invariant that makes speculating here safe: this function may only
  // ever make the next cycle faster, never narrower. It can add readiness
  // (warming a tab the user has not reached yet) but it can never take a tab
  // away, which is why the probe runs with recordFailure: false — see
  // ensurePageGestureAvailable for why a speculative timeout is not evidence
  // of an unusable tab. Nothing in this path may write the negative cache.
  //
  // Suppression is layered so that invariant costs nothing: probes run one at
  // a time so a cold window cannot become four simultaneous injections,
  // neighborWarmupTabIds stops two live chains probing the same tab,
  // neighborPreprobedUntilByTabId replaces the negative cache's job of not
  // retrying a failure immediately, and the generation check retires this
  // chain as soon as a newer switch has a better idea of where the user is.
  async function warmNeighborReadiness(
    originTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    settings: TabWheelSettings,
  ): Promise<void> {
    // Probing during a cycle only happens on the restricted-page skip path, so
    // with that off these injections would buy the next gesture nothing.
    if (!settings.skipRestrictedPages) return;
    const windowId = originTab.windowId;
    if (windowId == null) return;
    const generation = beginNeighborWarmupGeneration(windowId);
    for (const neighborTab of collectNeighborCandidateTabs(originTab, candidateTabs, settings)) {
      if (!isNeighborWarmupCurrent(windowId, generation)) return;
      const neighborTabId = neighborTab.id;
      if (neighborTabId == null || !shouldWarmNeighborTab(neighborTab)) continue;
      neighborWarmupTabIds.add(neighborTabId);
      let didBecomeReady = false;
      try {
        didBecomeReady = await ensurePageGestureAvailable(neighborTab, { recordFailure: false });
      } finally {
        neighborWarmupTabIds.delete(neighborTabId);
      }
      if (didBecomeReady) continue;
      neighborPreprobedUntilByTabId.set(
        neighborTabId,
        Date.now() + NEIGHBOR_PREPROBE_RETRY_COOLDOWN_MS,
      );
    }
  }

  async function activateTab(targetTab: Tabs.Tab, options: ActivateTabOptions = {}): Promise<boolean> {
    if (targetTab.id == null) return false;
    const didActivate = await browser.tabs
      .update(targetTab.id, { active: true })
      .then(() => true)
      .catch(() => false);
    if (!didActivate) return false;
    setDiscardedWakeHold(targetTab);
    if (targetTab.windowId != null) {
      await recordRecentTab(targetTab.id, targetTab.windowId);
    }
    if (options.restoreScrollAsync === true) {
      void restoreScroll(targetTab).catch(() => {});
      return true;
    }
    await restoreScroll(targetTab);
    return true;
  }

  function runRawSerializedWindowTask<T>(
    tab: Tabs.Tab | undefined,
    windowId: number | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    return windowGestureTaskQueue.run(
      windowId ?? tab?.windowId ?? FALLBACK_CYCLE_LOCK_WINDOW_ID,
      task,
    );
  }

  async function runSerializedWindowTask<T>(
    tab: Tabs.Tab | undefined,
    windowId: number | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    const resolvedWindowId = windowId ?? tab?.windowId ?? FALLBACK_CYCLE_LOCK_WINDOW_ID;
    const dragTail = tabDragTailsByWindowId.get(resolvedWindowId);
    if (dragTail) await dragTail;
    return await runRawSerializedWindowTask(tab, windowId, task);
  }

  async function waitForTabDrag(tab?: Tabs.Tab): Promise<void> {
    if (tab?.windowId == null) return;
    const dragTail = tabDragTailsByWindowId.get(tab.windowId);
    if (dragTail) await dragTail;
  }

  function releaseTabDragSession(gestureId: string): void {
    const session = tabDragSessionsById.get(gestureId);
    if (!session) return;
    if (session.timeoutId != null) clearTimeout(session.timeoutId);
    tabDragSessionsById.delete(gestureId);
    session.release();
  }

  function refreshTabDragSessionTimeout(session: BackgroundTabDragSession): void {
    if (session.timeoutId != null) clearTimeout(session.timeoutId);
    session.timeoutId = setTimeout(
      () => releaseTabDragSession(session.gestureId),
      TAB_DRAG_SESSION_TIMEOUT_MS,
    );
  }

  async function beginTabDrag(
    gestureId: string,
    tab?: Tabs.Tab,
  ): Promise<TabWheelActionResult> {
    if (!gestureId || tab?.id == null || tab.windowId == null) {
      return { ok: false, reason: "No active tab" };
    }
    const existing = tabDragSessionsById.get(gestureId);
    if (existing) {
      if (existing.tabId !== tab.id || existing.windowId !== tab.windowId) {
        return { ok: false, reason: "Invalid drag session" };
      }
      await existing.ready;
      if (tabDragSessionsById.get(gestureId) !== existing) {
        return { ok: false, reason: "Drag session expired" };
      }
      refreshTabDragSessionTimeout(existing);
      return { ok: true };
    }

    const windowId = tab.windowId;
    const previousTail = tabDragTailsByWindowId.get(windowId) ?? Promise.resolve();
    let releaseOwnedQueue = () => {};
    const ownedQueue = new Promise<void>((resolve) => {
      releaseOwnedQueue = resolve;
    });
    let wasReleased = false;
    const release = () => {
      if (wasReleased) return;
      wasReleased = true;
      releaseOwnedQueue();
    };
    const dragTail = previousTail.then(() => ownedQueue);
    tabDragTailsByWindowId.set(windowId, dragTail);
    void dragTail.then(() => {
      if (tabDragTailsByWindowId.get(windowId) === dragTail) {
        tabDragTailsByWindowId.delete(windowId);
      }
    });

    const ready = (async () => {
      await previousTail;
      await runRawSerializedWindowTask(tab, windowId, async () => {});
    })();
    const session: BackgroundTabDragSession = {
      gestureId,
      tabId: tab.id,
      windowId,
      ready,
      release,
      timeoutId: null,
    };
    tabDragSessionsById.set(gestureId, session);
    await ready;
    if (tabDragSessionsById.get(gestureId) !== session) {
      return { ok: false, reason: "Drag session expired" };
    }
    refreshTabDragSessionTimeout(session);
    return { ok: true };
  }

  async function endTabDrag(
    gestureId: string,
    tab?: Tabs.Tab,
  ): Promise<TabWheelActionResult> {
    const session = tabDragSessionsById.get(gestureId);
    if (!session) return { ok: true };
    if (tab?.id !== session.tabId) {
      return { ok: false, reason: "Invalid drag session" };
    }
    releaseTabDragSession(gestureId);
    return { ok: true };
  }

  async function recordFirstGestureCycle(): Promise<void> {
    const state = await loadTabWheelOnboardingState();
    if (state.firstGestureCycleCompleted) return;
    await saveTabWheelOnboardingState({
      ...state,
      firstGestureCycleCompleted: true,
    });
  }

  async function cycleUnlocked(
    direction: "prev" | "next",
    source: TabWheelCycleSource,
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    await ensureLoaded();
    const activeTab = await resolveActiveTab(tab, windowId);
    if (!activeTab?.id || activeTab.windowId == null) {
      return { ok: false, reason: "No active tab" };
    }
    const settings = await getSettings();
    const tabs = await getWindowTabs(activeTab.windowId);
    await reconcileRecentTabs(activeTab.windowId, tabs);
    const eligibleTabs = await getGestureEligibleTabs(tabs, settings, activeTab.windowId, activeTab);
    if (eligibleTabs.length === 0) return { ok: false, reason: "No eligible tabs" };

    const candidateTabs = eligibleTabs;
    const targetTab = await resolveAvailableCycleTargetTab(activeTab, candidateTabs, direction, settings);
    if (!targetTab?.id) {
      return { ok: false, reason: "Edge of tab list" };
    }

    cancelScrollRestore(activeTab.id);
    captureTabScrollUnlessWaking(activeTab, settings);
    const didActivate = await activateTab(targetTab, { restoreScrollAsync: true });
    if (!didActivate) return { ok: false, reason: "Tab no longer exists" };
    // Detached on purpose. `void` keeps these probes out of the promise this
    // function returns, and that promise is the one runSerializedWindowTask
    // chains the next queued gesture on — so a second gesture starts the
    // moment this switch resolves, never behind up to four 320ms probes.
    // Awaiting here would delay both the response and the next switch.
    void warmNeighborReadiness(targetTab, candidateTabs, settings).catch(() => {});
    if (source === "gesture") {
      void recordFirstGestureCycle().catch(() => {});
    }
    return { ok: true, tabId: targetTab.id };
  }

  async function cycle(
    direction: "prev" | "next",
    source: TabWheelCycleSource,
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(
      tab,
      windowId,
      () => cycleUnlocked(direction, source, tab, windowId),
    );
  }

  function getRecentCandidateTabs(
    windowId: number,
    tabs: Tabs.Tab[],
    activeTabId: number,
  ): Tabs.Tab[] {
    const tabsById = new Map<number, Tabs.Tab>();
    for (const candidate of tabs) {
      if (candidate.id != null) tabsById.set(candidate.id, candidate);
    }
    return (recentTabIdsByWindowId[windowKey(windowId)] || [])
      .filter((tabId) => tabId !== activeTabId)
      .map((tabId) => tabsById.get(tabId))
      .filter((candidate): candidate is Tabs.Tab => candidate != null);
  }

  async function openNativeNewTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "No active tab" };
      }
      const createdTab = await browser.tabs.create({
        active: true,
        windowId: activeTab.windowId,
        index: getTabIndex(activeTab) + 1,
        openerTabId: activeTab.id,
      }).catch(() => null);
      if (!createdTab) return { ok: false, reason: "New tab unavailable" };
      invalidateWindowTabsCache(activeTab.windowId);
      if (createdTab.id != null && createdTab.windowId != null) {
        await recordRecentTab(createdTab.id, createdTab.windowId);
      }
      return { ok: true, tabId: createdTab.id };
    });
  }

  async function activateMostRecentTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "No active tab" };
      }
      const tabs = await getWindowTabs(activeTab.windowId);
      await reconcileRecentTabs(activeTab.windowId, tabs);
      const settings = await getSettings();
      for (const targetTab of getRecentCandidateTabs(activeTab.windowId, tabs, activeTab.id)) {
        cancelScrollRestore(activeTab.id);
        captureTabScrollUnlessWaking(activeTab, settings);
        if (await activateTab(targetTab, { restoreScrollAsync: true })) {
          return { ok: true, tabId: targetTab.id };
        }
      }
      return { ok: false, reason: "No recent tab" };
    });
  }

  async function closeCurrentTabAndActivateRecent(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "No active tab" };
      }
      const tabs = await getWindowTabs(activeTab.windowId);
      await reconcileRecentTabs(activeTab.windowId, tabs);
      let activatedTabId: number | undefined;
      cancelScrollRestore(activeTab.id);
      for (const targetTab of getRecentCandidateTabs(activeTab.windowId, tabs, activeTab.id)) {
        if (await activateTab(targetTab, { restoreScrollAsync: true })) {
          activatedTabId = targetTab.id;
          break;
        }
      }
      const didClose = await browser.tabs.remove(activeTab.id)
        .then(() => true)
        .catch(() => false);
      invalidateWindowTabsCache(activeTab.windowId);
      if (!didClose) return { ok: false, reason: "Close tab failed" };
      return { ok: true, tabId: activatedTabId };
    });
  }

  async function duplicateTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "No active tab" };
      }
      const duplicatedTab = await browser.tabs.duplicate(activeTab.id).catch(() => null);
      if (!duplicatedTab?.id) return { ok: false, reason: "Duplicate unavailable" };
      const activatedTab = await browser.tabs.update(duplicatedTab.id, { active: true }).catch(() => null);
      if (!activatedTab) return { ok: false, reason: "Duplicate unavailable" };
      invalidateWindowTabsCache(activeTab.windowId);
      await recordRecentTab(duplicatedTab.id, duplicatedTab.windowId ?? activeTab.windowId);
      return { ok: true, tabId: duplicatedTab.id };
    });
  }

  async function moveCurrentTabUnlocked(
    direction: TabWheelMoveDirection,
    tab?: Tabs.Tab,
  ): Promise<TabWheelMoveResult> {
    await ensureLoaded();
    if (tab?.id == null) {
      return { ok: false, moved: false, reason: "No active tab" };
    }
    const activeTab = await browser.tabs.get(tab.id).catch(() => null);
    if (!activeTab?.id || activeTab.windowId == null || activeTab.active !== true) {
      return { ok: false, moved: false, reason: "Tab changed" };
    }
    const tabs = await getWindowTabs(activeTab.windowId);
    const targetIndex = resolveTabDragTargetIndex(activeTab, tabs, direction);
    if (targetIndex == null) {
      return { ok: true, moved: false, tabId: activeTab.id, index: activeTab.index };
    }
    const movedResult = await browser.tabs
      .move(activeTab.id, { index: targetIndex })
      .catch(() => null);
    const movedTab = resolveMovedTabResult(movedResult, activeTab.id);
    if (!movedTab) {
      return { ok: false, moved: false, reason: "Tab move failed" };
    }
    invalidateWindowTabsCache(activeTab.windowId);
    return {
      ok: true,
      moved: true,
      tabId: movedTab.id,
      index: movedTab.index,
    };
  }

  async function moveCurrentTab(
    direction: TabWheelMoveDirection,
    tab?: Tabs.Tab,
    gestureId?: string,
  ): Promise<TabWheelMoveResult> {
    const session = gestureId ? tabDragSessionsById.get(gestureId) : undefined;
    if (
      !session
      || tab?.id !== session.tabId
      || tab.windowId !== session.windowId
    ) {
      if (session && tab?.id === session.tabId) releaseTabDragSession(session.gestureId);
      return { ok: false, moved: false, reason: "Drag session expired" };
    }
    refreshTabDragSessionTimeout(session);
    await session.ready;
    return await runRawSerializedWindowTask(
      tab,
      session.windowId,
      () => moveCurrentTabUnlocked(direction, tab),
    );
  }

  async function refreshCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelRefreshResult> {
    await ensureLoaded();
    const activeTab = await resolveActiveTab(tab, windowId);
    if (!activeTab?.id || activeTab.windowId == null) {
      return {
        ok: false,
        reason: "No active tab",
        contentScriptStatus: "unavailable",
      };
    }

    if (isPageGestureRestrictedUrl(activeTab.url)) {
      markContentScriptUnavailable(activeTab);
      return {
        ok: false,
        reason: "TabWheel cannot run on this page.",
        overview: await getOverview(activeTab, activeTab.windowId),
        contentScriptStatus: "unavailable",
      };
    }

    const wasReady = await pingContentScript(activeTab);
    const injection = await injectContentScriptIntoTab(activeTab);
    if (injection !== "injected") {
      const overview = await getOverview(activeTab, activeTab.windowId);
      if (wasReady || overview.contentScriptStatus === "ready") {
        return {
          ok: true,
          overview,
          contentScriptStatus: overview.contentScriptStatus,
          injected: false,
        };
      }
      markContentScriptUnavailable(activeTab);
      return {
        ok: false,
        reason: "TabWheel cannot run on this page.",
        overview,
        contentScriptStatus: overview.contentScriptStatus,
        injected: false,
      };
    }

    const currentTab = await browser.tabs.get(activeTab.id).catch(() => activeTab);
    const isReady = await waitForContentScriptReady(currentTab);
    const overview = await getOverview(currentTab, activeTab.windowId);
    if (!isReady || overview.contentScriptStatus !== "ready") {
      markContentScriptUnavailable(currentTab);
      return {
        ok: false,
        reason: "TabWheel refresh failed",
        overview,
        contentScriptStatus: overview.contentScriptStatus,
        injected: true,
      };
    }

    return {
      ok: true,
      overview,
      contentScriptStatus: "ready",
      injected: true,
    };
  }

  async function saveScrollPosition(
    tabId: number,
    windowId: number,
    rawUrl: string | undefined,
    scrollData: ScrollData,
  ): Promise<TabWheelActionResult> {
    await ensureLoaded();
    const settings = await getSettings();
    if (!settings.restorePagePosition) return { ok: true };
    const url = normalizePageUrl(rawUrl);
    if (!url) return { ok: false, reason: "Unsupported page" };
    const scroll = normalizeScrollData(scrollData);
    const key = tabKey(tabId);
    const existing = scrollMemoryByTabId[key];
    if (
      existing?.url === url
      && existing.scrollX === scroll.scrollX
      && existing.scrollY === scroll.scrollY
      && existing.scrollRatioX === scroll.scrollRatioX
      && existing.scrollRatioY === scroll.scrollRatioY
      && existing.scrollWidth === scroll.scrollWidth
      && existing.scrollHeight === scroll.scrollHeight
      && existing.viewportWidth === scroll.viewportWidth
      && existing.viewportHeight === scroll.viewportHeight
    ) {
      return { ok: true };
    }
    scrollMemoryByTabId[key] = buildScrollMemoryEntry(tabId, windowId, url, scroll);
    await saveScrollMemory();
    return { ok: true };
  }

  function registerLifecycleListeners(): void {
    browser.runtime.onInstalled.addListener((details: { reason: string; previousVersion?: string }) => {
      // Installs and extension updates leave existing tabs without live content
      // scripts. Browser updates reload tabs, so manifest injection covers those.
      if (details.reason !== "install" && details.reason !== "update") return;
      void migrationReady
        .catch(() => {})
        .then(async () => {
          void activateExistingContentScripts()
            .then(ensureActiveTabContentScripts)
            .catch((error) => { console.warn("[TabWheel] install-time content script activation failed:", error); });
          const previousMajor = Number(details.previousVersion?.split(".")[0] || 0);
          if (details.reason === "install" || (details.reason === "update" && previousMajor < 4)) {
            await browser.tabs.create({
              url: browser.runtime.getURL("onboarding/onboarding.html"),
              active: true,
            }).catch((error) => {
              console.warn("[TabWheel] onboarding page could not be opened:", error);
            });
          }
        });
    });

    browser.storage.onChanged.addListener((changes: Record<string, browser.Storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];
      if (!settingsChange) return;
      const previousSettings = normalizeTabWheelSettings(settingsChange.oldValue);
      const nextSettings = normalizeTabWheelSettings(settingsChange.newValue);
      updateSettingsCache(settingsChange.newValue);
      if (previousSettings.restorePagePosition && !nextSettings.restorePagePosition) {
        scrollMemoryByTabId = {};
        void browser.storage.local.remove(TABWHEEL_STORAGE_KEYS.scrollMemory).catch(() => {});
      }
    });

    browser.tabs.onCreated.addListener((createdTab: Tabs.Tab) => {
      invalidateWindowTabsCache(createdTab.windowId);
    });

    browser.tabs.onActivated.addListener((activeInfo: { tabId: number; windowId: number }) => {
      const previousTabId = activeTabIdsByWindowId.get(activeInfo.windowId);
      activeTabIdsByWindowId.set(activeInfo.windowId, activeInfo.tabId);
      const wakeHold = discardedWakeHoldByWindowId.get(activeInfo.windowId);
      if (wakeHold && wakeHold.tabId !== activeInfo.tabId) discardedWakeHoldByWindowId.delete(activeInfo.windowId);
      if (previousTabId != null && previousTabId !== activeInfo.tabId) {
        cancelScrollRestore(previousTabId);
      }
      void recordRecentTab(activeInfo.tabId, activeInfo.windowId);
      void ensureContentScriptForActiveTab(activeInfo.tabId).catch(() => {});
      void applyToolbarBadgeForTabId(activeInfo.tabId).catch(() => {});
    });

    browser.tabs.onMoved.addListener((_tabId: number, moveInfo: { windowId?: number }) => {
      invalidateWindowTabsCache(moveInfo.windowId);
    });

    browser.tabs.onAttached.addListener((_tabId: number, attachInfo: { newWindowId?: number }) => {
      invalidateWindowTabsCache(attachInfo.newWindowId);
    });

    browser.tabs.onDetached.addListener((tabId: number, detachInfo: { oldWindowId?: number }) => {
      for (const session of tabDragSessionsById.values()) {
        if (session.tabId === tabId) releaseTabDragSession(session.gestureId);
      }
      invalidateWindowTabsCache(detachInfo.oldWindowId);
    });

    browser.tabs.onRemoved.addListener(async (tabId: number, removeInfo?: { windowId?: number }) => {
      for (const session of tabDragSessionsById.values()) {
        if (session.tabId === tabId) releaseTabDragSession(session.gestureId);
      }
      invalidateWindowTabsCache(removeInfo?.windowId);
      await ensureLoaded();
      delete scrollMemoryByTabId[tabKey(tabId)];
      contentScriptReadyUrlsByTabId.delete(tabId);
      contentScriptUnavailableUrlsByTabId.delete(tabId);
      neighborPreprobedUntilByTabId.delete(tabId);
      scrollRestoreTokensByTabId.delete(tabId);
      clearDiscardedWakeHoldForTab(tabId);
      forgetToolbarBadgeTab(tabId);
      for (const [windowId, activeTabId] of activeTabIdsByWindowId) {
        if (activeTabId === tabId) activeTabIdsByWindowId.delete(windowId);
      }
      let recentTabsChanged = false;
      for (const [key, tabIds] of Object.entries(recentTabIdsByWindowId)) {
        const nextTabIds = tabIds.filter((candidate) => candidate !== tabId);
        if (nextTabIds.length === tabIds.length) continue;
        recentTabsChanged = true;
        if (nextTabIds.length > 0) recentTabIdsByWindowId[key] = nextTabIds;
        else delete recentTabIdsByWindowId[key];
      }
      if (recentTabsChanged) await saveRecentTabState();
      await saveScrollMemory();
    });

    browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string; pinned?: boolean; hidden?: boolean; groupId?: number; status?: string }, updatedTab?: Tabs.Tab) => {
      if (changeInfo.url || changeInfo.pinned != null || changeInfo.hidden != null || changeInfo.groupId != null) {
        invalidateWindowTabsCache(updatedTab?.windowId);
      }
      if (changeInfo.status === "complete") {
        clearDiscardedWakeHoldForTab(tabId);
      }
      if (changeInfo.url) {
        contentScriptReadyUrlsByTabId.delete(tabId);
        contentScriptUnavailableUrlsByTabId.delete(tabId);
        cancelScrollRestore(tabId);
      }
      // Chrome clears tab-scoped badges on navigation, so re-apply on both the
      // URL change and the load completing.
      if (changeInfo.url || changeInfo.status === "complete") {
        if (updatedTab) void applyToolbarBadgeForTab(updatedTab).catch(() => {});
        else void applyToolbarBadgeForTabId(tabId).catch(() => {});
      }
    });

    const tabGroupsApi = getBrowserTabGroupsApi();
    const invalidateTabGroupWindow = (group: BrowserTabGroup): void => {
      invalidateWindowTabsCache(group.windowId);
    };
    const addTabGroupInvalidationListener = (event: BrowserTabGroupEvent | undefined): void => {
      if (typeof event?.addListener === "function") event.addListener(invalidateTabGroupWindow);
    };
    addTabGroupInvalidationListener(tabGroupsApi?.onCreated);
    addTabGroupInvalidationListener(tabGroupsApi?.onRemoved);
    addTabGroupInvalidationListener(tabGroupsApi?.onUpdated);

    browser.windows.onRemoved.addListener((windowId: number) => {
      for (const session of tabDragSessionsById.values()) {
        if (session.windowId === windowId) releaseTabDragSession(session.gestureId);
      }
      void (async () => {
        await ensureLoaded();
        invalidateWindowTabsCache(windowId);
        delete recentTabIdsByWindowId[windowKey(windowId)];
        activeTabIdsByWindowId.delete(windowId);
        discardedWakeHoldByWindowId.delete(windowId);
        neighborWarmupGenerationByWindowId.delete(windowId);
        for (const [key, entry] of Object.entries(scrollMemoryByTabId)) {
          if (entry.windowId === windowId) {
            delete scrollMemoryByTabId[key];
            scrollRestoreTokensByTabId.delete(entry.tabId);
          }
        }
        await saveRecentTabState();
        await saveScrollMemory();
      })();
    });

    browser.runtime.onStartup.addListener(async () => {
      // Housekeeping is best-effort: storage failures must not skip reinject.
      try {
        await ensureLoaded();
        scrollMemoryByTabId = trimScrollMemory(scrollMemoryByTabId);
        recentTabIdsByWindowId = {};
        windowTabsCacheByWindowId.clear();
        collapsedTabGroupIdsCacheByWindowId.clear();
        contentScriptReadyUrlsByTabId.clear();
        contentScriptUnavailableUrlsByTabId.clear();
        neighborPreprobedUntilByTabId.clear();
        neighborWarmupGenerationByWindowId.clear();
        scrollRestoreTokensByTabId.clear();
        activeTabIdsByWindowId.clear();
        discardedWakeHoldByWindowId.clear();
        await saveScrollMemory();
        await browser.storage.local.remove(TABWHEEL_STORAGE_KEYS.recentTabs);
      } catch (error) {
        console.warn("[TabWheel] startup housekeeping failed:", error);
      }

      // Browser cold start restores tabs without an install/update event. Keep
      // both inject passes awaited so the MV3 worker stays alive, but start the
      // delayed pass before awaiting either one so a stuck scan cannot gate it.
      const activateRestoredTabs = async (): Promise<void> => {
        await activateExistingContentScripts();
        await ensureActiveTabContentScripts();
      };
      const immediateActivation = activateRestoredTabs().catch((error) => {
        console.warn("[TabWheel] startup content script activation failed:", error);
      });
      // Session restore can finish after the first query; one delayed pass covers
      // tabs that were still loading or not yet present (inject only).
      const delayedActivation = (async () => {
        try {
          await sleep(2000);
          await activateRestoredTabs();
        } catch (error) {
          console.warn("[TabWheel] delayed startup content script activation failed:", error);
        }
      })();
      await Promise.all([immediateActivation, delayedActivation]);
    });

    // Re-enabling the extension does not fire onInstalled, but it does kill page
    // scripts. Prime focused tabs each time the worker starts.
    void ensureActiveTabContentScripts().catch(() => {});
  }

  return {
    ensureLoaded,
    activateExistingContentScripts,
    getOverview,
    cycle,
    openNativeNewTab,
    activateMostRecentTab,
    closeCurrentTabAndActivateRecent,
    duplicateTab,
    beginTabDrag,
    moveCurrentTab,
    endTabDrag,
    waitForTabDrag,
    refreshCurrentTab,
    resetState,
    saveScrollPosition,
    markContentScriptReady,
    registerLifecycleListeners,
  };
}
