// The background service worker's TabWheel domain. Everything that reads or
// changes browser tab state on behalf of the page-side gesture code
// (src/lib/appInit) and the popup lives here; handlers/tabWheelMessageHandler.ts
// routes runtime messages to the TabWheelDomain methods returned below.
//
// Main flows:
// - Cycle (modifier + wheel): query the window's tabs (briefly cached) ->
//   filter to the eligible tabs for the current settings -> pick the next tab
//   in strip order -> probe its content script when restricted-page skipping
//   is on -> activate it -> restore its saved scroll position. After landing,
//   the neighbors a continued gesture would reach are probed off the hot path.
// - Click actions (new tab, back to recent tab, close to recent, duplicate,
//   mute, history back/forward) act on the active tab of the sender's window.
// - Drag current tab: a drag session reserves its window, so its moves never
//   interleave with a cycle, a click action, or another drag in that window.
// - Scroll memory: pages report their scroll position, we keep it per tab, and
//   a switch that lands on the tab restores it.
// - Lifecycle: install, update, browser startup, and every worker start inject
//   the content script into tabs that are already open, so nothing needs a
//   reload to start working.
//
// Every gesture, click action, and drag move for a window runs through one
// per-window task queue, so each one sees the tab strip the previous one left.
//
// State: the MV3 service worker can be killed at any moment and restarted by
// the next event, so every Map, Set, and timer in createTabWheelDomain is a
// per-worker cache that must be safe to lose. Only settings, onboarding state,
// recent-tab history, and scroll memory persist, in browser.storage.local.
//
// Pure decision logic (cycle target index, drag target index, restricted-URL
// rules) lives in src/lib/core/tabWheel/* so it can be tested without a
// browser. This file is the browser-facing glue around it.

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
import { updateTabToolbarBadge } from "./toolbarBadge";

/** Saved scroll positions, keyed by stringified tab id (see tabKey). */
type ScrollMemoryByTabId = Record<string, TabWheelScrollMemoryEntry>;
/** Most-recent-first tab ids per window, keyed by stringified window id. */
type RecentTabIdsByWindowId = TabWheelRecentTabState;

/**
 * The slice of Chrome's tabGroups API this module uses. The polyfill's types
 * don't include it, so we declare what we read and look it up at runtime.
 */
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

/**
 * Counts from a bulk content-script injection pass. Tabs that are discarded
 * or on restricted URLs are "skipped" and never counted as attempted.
 */
interface ExistingTabActivationResult {
  attempted: number;
  injected: number;
  skipped: number;
  failed: number;
}

/** A short-lived snapshot of one window's tabs (see WINDOW_TABS_CACHE_TTL_MS). */
interface WindowTabsCacheEntry {
  tabs: Tabs.Tab[];
  expiresAt: number;
}

interface ActivateTabOptions {
  /**
   * Start the scroll restore without waiting for it. Gesture paths set this so
   * the switch resolves as soon as the tab is active.
   */
  restoreScrollAsync?: boolean;
}

interface EnsurePageGestureProbeOptions {
  // Speculative callers pass false (see warmNeighborReadiness). A failed probe
  // then costs nothing but time, instead of narrowing the user's next cycle.
  recordFailure?: boolean;
}

/**
 * A negative readiness answer for one tab. It only applies while the tab is
 * still on `url`; a navigation makes it stale.
 */
interface ContentScriptUnavailableEntry {
  url: string;
  expiresAt: number;
}

/**
 * Marks a discarded tab we just switched to as "waking". While the hold is
 * live, cycling away does not capture its scroll position, because a waking
 * document reports top-of-page and would overwrite the saved position.
 */
interface DiscardedTabWakeHold {
  tabId: number;
  expiresAt: number;
}

/**
 * One in-progress "drag current tab" gesture, identified by the page-generated
 * gestureId. The session owns its window's drag slot until released.
 */
interface BackgroundTabDragSession {
  gestureId: string;
  tabId: number;
  windowId: number;
  /** Resolves once earlier drags and queued window tasks have drained. */
  ready: Promise<void>;
  /** Frees the window's drag slot. Idempotent. */
  release: () => void;
  /** Releases an abandoned session; reset on every begin/move. */
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * The background API for TabWheel. Methods that take `tab` expect the message
 * sender's tab; `windowId` is for callers without one, such as the popup.
 * Expected failures come back as `ok: false` results rather than throws, and
 * their `reason` is user-facing copy shown as-is.
 */
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
  toggleMuteCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  goBackInCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  goForwardInCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult>;
  beginTabDrag(gestureId: string, tab?: Tabs.Tab): Promise<TabWheelActionResult>;
  moveCurrentTab(direction: TabWheelMoveDirection, tab?: Tabs.Tab, gestureId?: string): Promise<TabWheelMoveResult>;
  endTabDrag(gestureId: string, tab?: Tabs.Tab): Promise<TabWheelActionResult>;
  waitForTabDrag(tab?: Tabs.Tab): Promise<void>;
  resetState(): Promise<TabWheelActionResult>;
  saveScrollPosition(tabId: number, windowId: number, url: string | undefined, scroll: ScrollData): Promise<TabWheelActionResult>;
  markContentScriptReady(tab?: Tabs.Tab): TabWheelActionResult;
  registerLifecycleListeners(): void;
}

// Queue key for window tasks when neither the caller nor the tab names a
// window. Chrome window ids are positive, so 0 never collides with one.
const FALLBACK_CYCLE_LOCK_WINDOW_ID = 0;
// Recent-tab history's pre-migration storage key. storageMigrations moves it
// to the current key; reading it as a fallback keeps history across a failed
// migration, since ensureLoaded tolerates migrationReady rejecting.
const LEGACY_RECENT_TABS_STORAGE_KEY = "tabWheelMruState";
// Long enough to share one tabs.query across the ticks of a fast wheel burst,
// short enough that a missed invalidation event heals almost immediately.
const WINDOW_TABS_CACHE_TTL_MS = 350;
// Coalesces bursts of scroll saves (a cycle captures the tab it leaves, and
// pages report as they scroll) into one storage write.
const SCROLL_MEMORY_SAVE_DEBOUNCE_MS = 120;
// Bounds how long resolving a switch may wait on one candidate's readiness.
// Expiry means "slow", which lands rather than skips, so the budget only has
// to cover the common fast path — not protect reachability.
const GESTURE_TARGET_PROBE_TIMEOUT_MS = 150;
// How many unavailable candidates one gesture tick may skip past before it
// gives up. Caps the worst-case tick at a few probe budgets.
const MAX_GESTURE_PROBE_ATTEMPTS = 4;
// How far the post-switch pre-probe looks in each cycle direction. Two covers
// the tabs a continued gesture reaches within the next couple of cooldowns
// (the ones the hot-path readiness probe would otherwise pay for), while
// keeping the speculative work per switch bounded at four tabs.
const NEIGHBOR_PREPROBE_DEPTH = 2;
// How long a "this tab can't host the content script" answer is trusted before
// the tab is probed again. Short, so a transient refusal (a tab mid-navigation,
// say) doesn't hide the tab from cycling for long.
const CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS = 2500;
// A speculative probe deliberately does not write the negative cache, so it
// needs its own way to not retry a tab that just failed. Mirrors the negative
// cache's window so the retry cadence is unchanged; the difference is only
// that this one is invisible to cycle eligibility.
const NEIGHBOR_PREPROBE_RETRY_COOLDOWN_MS = CONTENT_SCRIPT_UNAVAILABLE_CACHE_TTL_MS;
// Ping schedule after injecting on a gesture or tab-activation path. Kept
// short; hot-path callers also cap it with GESTURE_TARGET_PROBE_TIMEOUT_MS.
const GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS = [0, 80, 180] as const;
// Delivery retries for SET_SCROLL while a landed tab's content script comes
// up. Once delivered, the page runs its own retries until layout settles.
const SCROLL_RESTORE_RETRY_DELAYS_MS = [0, 80, 220, 500, 900, 1500, 2400, 3600] as const;
// A discarded tab reloads from scratch when woken, so it gets one extra,
// later attempt.
const DISCARDED_SCROLL_RESTORE_RETRY_DELAYS_MS = [...SCROLL_RESTORE_RETRY_DELAYS_MS, 4000] as const;
// A safety net, not the real release: the hold lifts when the wake completes
// (onUpdated status "complete"), the user switches away, or the tab closes.
// It only has to outlast a pathological never-completing load, so it must be
// generous — real wakes routinely exceed any sub-second grace period, and an
// expired hold lets cycle-away capture a waking document's top-of-page scroll
// over the position the user actually left.
const DISCARDED_WAKE_HOLD_SAFETY_MS = 15000;
// Releases a drag whose page went away without ending it. A live drag never
// reaches this: the page re-sends begin as a keepalive well inside the window.
const TAB_DRAG_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

// Persisted state is plain JSON objects, so window and tab ids become string
// keys. Always go through these so keys are spelled one way.
function windowKey(windowId: number): string {
  return String(windowId);
}

function tabKey(tabId: number): string {
  return String(tabId);
}

/**
 * Resolves with `task`'s value, or with `fallback` if it rejects or takes
 * longer than `timeoutMs`. The task itself is not cancelled; it keeps running
 * and its late result is ignored.
 */
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

/**
 * Clamps scroll data reported by a page (or read back from storage) to finite,
 * non-negative numbers. Missing ratios are derived from the offsets, so a
 * restore can land at the same relative spot after the page's height changes.
 */
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

/**
 * Parses stored scroll memory. Malformed entries, and entries filed under a key
 * that doesn't match their own tab id, are dropped rather than repaired.
 */
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

/** Keeps only the most recently updated MAX_SCROLL_MEMORY_ENTRIES entries. */
function trimScrollMemory(memory: ScrollMemoryByTabId): ScrollMemoryByTabId {
  const entries = Object.values(memory)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SCROLL_MEMORY_ENTRIES);
  return Object.fromEntries(entries.map((entry) => [tabKey(entry.tabId), entry]));
}

/**
 * Parses stored recent-tab history: positive integer ids only, deduplicated
 * with the first (most recent) occurrence kept, capped at MAX_RECENT_TABS.
 */
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

/** Chrome's tabGroups API, or null when it isn't exposed to this context. */
function getBrowserTabGroupsApi(): Partial<BrowserTabGroupsApi> | null {
  return (browser as unknown as { tabGroups?: Partial<BrowserTabGroupsApi> }).tabGroups ?? null;
}

function isCollapsedGroupTab(tab: Tabs.Tab, collapsedTabGroupIds: ReadonlySet<number>): boolean {
  return tab.groupId != null && collapsedTabGroupIds.has(tab.groupId);
}

// Ungrouped tabs (groupId -1, or undefined if the tabGroups API is ever
// unavailable) all normalize to the same implicit group, so without group
// support there is only one group and the filter below is a no-op — a
// graceful degrade rather than a special case.
function normalizeTabGroupId(groupId: number | undefined): number {
  return groupId ?? -1;
}

/**
 * Filters a window's tabs down to the ones a cycle may land on under the
 * current settings, sorted in tab-strip order. Pure: the content-script
 * negative cache is layered on top by getGestureEligibleTabs.
 */
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
      && (!settings.skipHiddenTabs || !isCollapsedGroupTab(tab, collapsedTabGroupIds))
      && (!settings.skipRestrictedPages || !isRestrictedTab(tab))
      && (!settings.cycleWithinTabGroup
        || activeTabGroupId == null
        || normalizeTabGroupId(tab.groupId) === activeTabGroupId))
    .sort((left, right) => getTabIndex(left) - getTabIndex(right));
}

/** Lets callers skip a storage write when a list came out unchanged. */
function hasSameNumberList(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Creates the domain. Call once per worker start, then call
 * registerLifecycleListeners synchronously so Chrome's events reach this
 * worker instance. `migrationReady` is the storage migration for this start;
 * persisted state is not read until it settles, whether or not it succeeds.
 */
export function createTabWheelDomain(options: {
  migrationReady?: Promise<unknown>;
} = {}): TabWheelDomain {
  const migrationReady = options.migrationReady ?? Promise.resolve();
  // Persisted state, mirrored in memory. Loaded once by ensureLoaded and
  // written back after each change, so a killed worker loses little.
  let scrollMemoryByTabId: ScrollMemoryByTabId = {};
  let recentTabIdsByWindowId: RecentTabIdsByWindowId = {};
  // Everything below is per-worker and rebuilt on demand after a restart.
  // Short-lived snapshots of tabs.query and tabGroups.query, dropped by the
  // tab and group events in registerLifecycleListeners.
  const windowTabsCacheByWindowId = new Map<number, WindowTabsCacheEntry>();
  const collapsedTabGroupIdsCacheByWindowId = new Map<number, {
    collapsedTabGroupIds: Set<number>;
    expiresAt: number;
  }>();
  // Tab id -> the URL its content script last confirmed it was running on.
  // Only trusted while the tab is still on that URL.
  const contentScriptReadyUrlsByTabId = new Map<number, string>();
  // Serializes gestures, click actions, and drag moves per window id.
  const windowGestureTaskQueue = createKeyedTaskQueue();
  const tabDragSessionsById = new Map<string, BackgroundTabDragSession>();
  // The tail of each window's chain of drag sessions. While present, new
  // window tasks wait for it (see runSerializedWindowTask).
  const tabDragTailsByWindowId = new Map<number, Promise<void>>();
  const recentTabStateWriteChain = createWriteChain();
  // The last active tab we saw per window, so onActivated knows which tab was
  // left and can cancel its pending scroll restore.
  const activeTabIdsByWindowId = new Map<number, number>();
  // Latest restore token per tab. A running restore stops once its token is
  // no longer current (see beginScrollRestore).
  const scrollRestoreTokensByTabId = new Map<number, number>();
  // The negative readiness cache. It removes tabs from cycling, so only the
  // hot path may write it (see resolvePageGestureReadiness).
  const contentScriptUnavailableUrlsByTabId = new Map<number, ContentScriptUnavailableEntry>();
  // Neighbor pre-probe bookkeeping (see warmNeighborReadiness).
  const neighborWarmupTabIds = new Set<number>();
  const neighborPreprobedUntilByTabId = new Map<number, number>();
  const neighborWarmupGenerationByWindowId = new Map<number, number>();
  const discardedWakeHoldByWindowId = new Map<number, DiscardedTabWakeHold>();
  let scrollRestoreSerial = 0;
  // Debounced scroll-memory save: callers each get a promise that settles
  // with the write that eventually covers their change.
  let scrollMemorySaveTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollMemorySaveResolvers: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  let scrollMemoryWriteChain: Promise<void> = Promise.resolve();
  // Kept current by storage.onChanged, so settings edits apply immediately.
  let settingsCache: TabWheelSettings | null = null;

  // Loads persisted state once per worker. Concurrent callers share the
  // in-flight load; a failed load is retried by the next caller.
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

  /** Settings from the in-memory cache, loading from storage on first use. */
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

  /**
   * Writes scroll memory now and settles every pending saveScrollMemory
   * promise with the result. Writes are chained so they land in order.
   */
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

  /**
   * Schedules a debounced write of scroll memory. The returned promise settles
   * when the write that includes this change finishes.
   */
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

  // Writes are chained so an older snapshot can never land after a newer one.
  function saveRecentTabState(): Promise<void> {
    return recentTabStateWriteChain.enqueue(() => browser.storage.local.set({
      [TABWHEEL_STORAGE_KEYS.recentTabs]: recentTabIdsByWindowId,
    }));
  }

  // Returns null instead of throwing when tabs.query rejects (for example, for
  // a window that just closed), so callers can tell "no answer" from "no tabs".
  function queryTabsSafe(queryInfo: Tabs.QueryQueryInfoType): Promise<Tabs.Tab[] | null> {
    return browser.tabs.query(queryInfo).catch(() => null);
  }

  async function queryActiveTab(windowId?: number): Promise<Tabs.Tab | null> {
    const [activeTab] = await queryTabsSafe(
      windowId != null ? { active: true, windowId } : { active: true, currentWindow: true },
    ) ?? [];
    return activeTab?.id != null && activeTab.windowId != null ? activeTab : null;
  }

  /**
   * The tab an action should act on: the sender's tab if it is still active,
   * otherwise whatever is active in its window (or in `windowId`, or the
   * current window). Re-reads the tab because the sender's snapshot is from
   * when the message was sent, and the user may have switched since.
   */
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

  /** Drops cached tabs and group state for a window, or for all windows. */
  function invalidateWindowTabsCache(windowId: number | undefined): void {
    if (windowId == null) {
      windowTabsCacheByWindowId.clear();
      collapsedTabGroupIdsCacheByWindowId.clear();
      return;
    }
    windowTabsCacheByWindowId.delete(windowId);
    collapsedTabGroupIdsCacheByWindowId.delete(windowId);
  }

  /**
   * A window's tabs, served from a brief cache. Callers that change the strip
   * (create, move, close) must invalidate it themselves rather than wait for
   * the tab events, which can arrive after the next wheel tick.
   */
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

  // The readiness caches are keyed by tab and pinned to a URL: a positive or
  // negative answer only holds while the tab is still on the URL it was
  // recorded for, and marking one side clears the other.
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

  /**
   * Ids of collapsed groups in a window, used to skip "hidden" tabs. Skips
   * the tabGroups query entirely when the setting is off or no tab is grouped.
   */
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

  /**
   * The tabs a gesture may cycle through: getEligibleTabs plus, when skipping
   * restricted pages, removal of tabs recently found unable to host the
   * content script. The only place an active tab becomes the group id that
   * cycle-within-group compares against.
   */
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

  // Scroll restores are cancelled by token, not by handle. Each restore takes
  // a fresh serial for its tab and checks it before every retry; bumping the
  // serial (a newer restore, the user leaving the tab, a navigation) makes
  // the older one stop at its next check.
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

  /**
   * The window's wake hold if it still covers `activeTabId`. A hold for a
   * different tab, or one past its safety timeout, is deleted on read.
   */
  function getActiveDiscardedWakeHold(windowId: number, activeTabId: number): DiscardedTabWakeHold | null {
    const hold = discardedWakeHoldByWindowId.get(windowId);
    if (!hold) return null;
    if (hold.tabId !== activeTabId || hold.expiresAt <= Date.now()) {
      discardedWakeHoldByWindowId.delete(windowId);
      return null;
    }
    return hold;
  }

  // Called after activating a tab. A no-op unless the tab was discarded, in
  // which case this activation is what wakes it.
  function setDiscardedWakeHold(tab: Tabs.Tab): void {
    if (tab.id == null || tab.windowId == null || tab.discarded !== true) return;
    discardedWakeHoldByWindowId.set(tab.windowId, {
      tabId: tab.id,
      expiresAt: Date.now() + DISCARDED_WAKE_HOLD_SAFETY_MS,
    });
  }

  function clearDiscardedWakeHoldForTab(tabId: number): void {
    for (const [windowId, hold] of discardedWakeHoldByWindowId) {
      if (hold.tabId === tabId) discardedWakeHoldByWindowId.delete(windowId);
    }
  }

  /**
   * Drops tabs that are no longer in the window from its recent-tab history.
   * onRemoved handles closed tabs; this also catches tabs dragged to another
   * window, so run it before reading the history.
   */
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

  // Moves a tab to the front of its window's recent-tab history. The history
  // is advisory, so a storage failure is logged and never blocks a gesture.
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

  /**
   * Injects the content script bundle with chrome.scripting. Resolves false,
   * never throws, when Chrome refuses (restricted page, missing permission, the
   * tab closed). Re-injecting into a live page is safe: the script tears down
   * its previous instance.
   */
  async function executeContentScriptInTab(tabId: number, allFrames: boolean): Promise<boolean> {
    const runtimeBrowser = browser as typeof browser & {
      scripting?: {
        executeScript(details: {
          target: { tabId: number; allFrames?: boolean };
          files: string[];
          injectImmediately?: boolean;
        }): Promise<unknown>;
      };
    };

    if (!runtimeBrowser.scripting?.executeScript) return false;
    try {
      await runtimeBrowser.scripting.executeScript({
        target: { tabId, ...(allFrames ? { allFrames: true } : {}) },
        files: ["contentScript.js"],
        // Restored documents may never reach the default document_idle phase.
        injectImmediately: true,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Injects the content script into an already-open tab. Discarded tabs have
   * no live document, so they are "skipped"; the manifest injects them when a
   * switch wakes them. Restricted URLs are skipped because Chrome refuses them.
   */
  async function injectContentScriptIntoTab(tab: Tabs.Tab): Promise<"injected" | "skipped" | "failed"> {
    if (tab.id == null || tab.discarded === true || isPageGestureRestrictedUrl(tab.url)) return "skipped";

    // Try all frames first so already-open pages match manifest injection as
    // closely as possible.
    if (await executeContentScriptInTab(tab.id, true)) return "injected";

    // Chrome can fail the all-frame call because of one restricted subframe. The
    // top frame is enough for page-level gestures, so fall back to that.
    return await executeContentScriptInTab(tab.id, false) ? "injected" : "failed";
  }

  // Reset to defaults: clears settings, recent-tab history, and scroll memory,
  // in storage and in memory (a live worker would otherwise keep serving the
  // old maps). Onboarding completion is kept so the first-run coach stays done.
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

  /**
   * Injects the content script into every open tab in every window. Used on
   * install, update, and browser startup, and by the popup and options page.
   * Tabs are injected in parallel; one tab failing does not stop the rest.
   */
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

  /**
   * Makes sure the active tab of each window has a live content script,
   * pinging first and injecting only if the ping goes unanswered. The active
   * tabs are the ones the user will gesture on first after a worker start.
   */
  async function ensureActiveTabContentScripts(): Promise<void> {
    const windows = await browser.windows.getAll().catch(() => []);
    await Promise.all(windows.map(async (win) => {
      if (win.id == null) return;
      const [activeTab] = await browser.tabs.query({ active: true, windowId: win.id }).catch(() => []);
      if (!activeTab || activeTab.id == null) return;
      // Prime the badge for every active tab (including restricted ones) each
      // time the service worker (re)starts, before the content-script path
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

  /**
   * Same check for one tab as it becomes active. The wait after injecting is
   * bounded by the gesture probe budget.
   */
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

  /**
   * Asks the tab's content script to answer and records the result in the
   * positive cache. A failed ping only clears the positive entry; it never
   * marks the tab unavailable, since the script may simply not be up yet.
   */
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

  // Pings on a schedule until the script answers. The default schedule is for
  // user-initiated refreshes, which can afford to wait longer than a gesture.
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

  /** The status the popup shows for a tab. Pings but never injects. */
  async function resolveContentScriptStatus(tab: Tabs.Tab | null): Promise<TabWheelContentScriptStatus> {
    if (!tab?.id) return "unavailable";
    if (isPageGestureRestrictedUrl(tab.url)) return "unavailable";
    if (isContentScriptKnownUnavailable(tab)) return "unavailable";
    const url = normalizePageUrl(tab.url);
    if (!url) return "unavailable";
    if (contentScriptReadyUrlsByTabId.get(tab.id) === url) return "ready";

    return await pingContentScript(tab) ? "ready" : "unavailable";
  }

  // Handles the page's "content script is up" message. The page also sends it
  // to pre-warm the MV3 worker before a gesture (see appInit's wheel and
  // modifier-keydown handlers), which works because this returns without
  // awaiting anything. Keep it that way, and keep its side effects to seeding
  // the readiness caches (the recent-tab touch below is detached and a no-op
  // for an already-current tab), or every gesture chord pays for what's added.
  function markContentScriptReady(tab?: Tabs.Tab): TabWheelActionResult {
    if (!tab?.id) return { ok: false, reason: "Couldn't find the current tab" };
    if (isPageGestureRestrictedUrl(tab.url)) return { ok: false, reason: "TabWheel can't save your place on this page" };
    const url = normalizePageUrl(tab.url);
    if (!url) return { ok: false, reason: "TabWheel can't save your place on this page" };
    markContentScriptAvailable(tab, url);
    if (tab.active === true && tab.windowId != null) {
      activeTabIdsByWindowId.set(tab.windowId, tab.id);
      void recordRecentTab(tab.id, tab.windowId);
    }
    return { ok: true };
  }

  // The negative cache feeds getGestureEligibleTabs — a write removes the tab
  // from what the next cycle can reach — so only provable rejection may write
  // it: a restricted URL, or an injection the browser refused. "Slow" —
  // readiness lagging the probe budget, including the budget expiring — never
  // writes it: a successful injection proves the page can host the script, so
  // lag is slowness, not evidence of a broken page.
  async function resolvePageGestureReadiness(
    tab: Tabs.Tab,
    { recordFailure = true }: EnsurePageGestureProbeOptions = {},
  ): Promise<"ready" | "slow" | "unavailable"> {
    if (tab.id == null) return "unavailable";
    const tabId = tab.id;
    if (isPageGestureRestrictedUrl(tab.url)) {
      if (recordFailure) markContentScriptUnavailable(tab);
      return "unavailable";
    }
    const url = normalizePageUrl(tab.url);
    if (!url) return "unavailable";
    if (contentScriptReadyUrlsByTabId.get(tab.id) === url) {
      contentScriptUnavailableUrlsByTabId.delete(tab.id);
      return "ready";
    }
    const readiness = await resolveWithTimeout<"ready" | "slow" | "unavailable">(
      (async () => {
        if (await pingContentScript(tab)) return "ready";
        const injection = await injectContentScriptIntoTab(tab);
        if (injection !== "injected") return "unavailable";
        const currentTab = await browser.tabs.get(tabId).catch(() => tab);
        return await waitForContentScriptReady(currentTab, GESTURE_CONTENT_SCRIPT_READY_RETRY_DELAYS_MS)
          ? "ready"
          : "slow";
      })(),
      GESTURE_TARGET_PROBE_TIMEOUT_MS,
      "slow",
    );
    if (readiness === "unavailable" && recordFailure) markContentScriptUnavailable(tab);
    return readiness;
  }

  /** True only when the tab is confirmed ready; "slow" counts as not ready. */
  async function ensurePageGestureAvailable(
    tab: Tabs.Tab,
    options: EnsurePageGestureProbeOptions = {},
  ): Promise<boolean> {
    return await resolvePageGestureReadiness(tab, options) === "ready";
  }

  /**
   * Sends the tab its saved scroll position, retrying while the content script
   * comes up. Only restores when the tab is still on the URL the position was
   * saved for. Stops early if a newer restore or a navigation supersedes it.
   */
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

  // Reads the tab's current scroll from its content script and saves it. Used
  // on the tab being left, so the position is fresh even if the page's own
  // debounced report hasn't arrived yet.
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

  // A discarded tab reports top-of-page while it wakes. Keep its saved entry
  // untouched until the wake has settled (see DiscardedTabWakeHold).
  function captureTabScrollUnlessWaking(tab: Tabs.Tab, settings: TabWheelSettings): void {
    if (!settings.restorePagePosition) return;
    if (tab.id == null || tab.windowId == null) return;
    if (getActiveDiscardedWakeHold(tab.windowId, tab.id)) return;
    void captureTabScroll(tab).catch(() => {});
  }

  /**
   * The popup's summary of a window: where the active tab sits among the tabs a
   * gesture can reach, how many there are, and whether this page is ready.
   */
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

  // The single place a cycle's next tab is resolved. The neighbor pre-probe
  // goes through here too, so it predicts exactly what the next gesture does.
  function resolveCycleTargetTab(
    activeTab: Tabs.Tab,
    candidateTabs: Tabs.Tab[],
    direction: "prev" | "next",
    settings: TabWheelSettings,
  ): Tabs.Tab | null {
    return resolveStripTargetTab(activeTab, candidateTabs, direction, settings.wrapAround);
  }

  /**
   * Picks the tab a cycle should land on. With restricted-page skipping on,
   * candidates are probed and provably unusable ones are skipped, up to
   * MAX_GESTURE_PROBE_ATTEMPTS. Returns null when there is nowhere to go.
   */
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
      // A sleeping (discarded) tab cannot answer a probe and injection refuses
      // to wake it, so probing would misfile it as unusable. Asleep is not
      // broken: landing on it is the real switch that may wake it, and the
      // eligibility filter has already applied the restricted-URL check.
      if (targetTab.discarded === true) return targetTab;
      // Land on "slow" too: the strip the user sees must be the strip the
      // wheel walks, so only provable rejection may remove a stop from it.
      if (!settings.skipRestrictedPages) return targetTab;
      if (await resolvePageGestureReadiness(targetTab) !== "unavailable") return targetTab;
      remainingTabs = remainingTabs.filter((candidate) => candidate.id !== targetTab.id);
    }
    // Out of attempts: don't land on a candidate we haven't probed. The
    // refusals are cached, so the next tick skips them cheaply and reaches
    // further.
    return null;
  }

  // Walks the cycle's own target resolution outward from the tab just
  // activated, so pre-probing inherits the exact tab-strip and wrap-around
  // semantics the next real gesture will use instead of re-deriving them.
  // Stops on a repeat: the resolver hands back the tab it was given once a
  // non-wrapping cycle reaches the edge, and a wrapping cycle in a short list
  // comes back around to somewhere already collected.
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

  // Fire-and-forget speculation that pays down the per-candidate readiness probe
  // the next gesture would otherwise pay in its hot path, before tabs.update.
  // It is never awaited by the cycle that spawns it (see cycleUnlocked), so
  // neither the cycle's response nor the serialized window queue waits on it.
  //
  // The invariant that makes speculating here safe: this function may only
  // ever make the next cycle faster, never narrower. It can add readiness
  // (warming a tab the user has not reached yet) but it can never take a tab
  // away, which is why the probe runs with recordFailure: false — see
  // resolvePageGestureReadiness for why a timeout is not evidence of an
  // unusable tab. Nothing in this path may write the negative cache.
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

  /**
   * Switches to a tab and does the bookkeeping every switch needs: a wake hold
   * if it was discarded, a recent-tab entry, and a scroll restore. Resolves
   * false if Chrome refused the switch, typically because the tab just closed.
   */
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

  // Runs `task` on the window's queue without checking for a drag. Only the
  // drag path uses this directly: a drag's own moves must not wait on the drag
  // slot they hold, or they would deadlock behind themselves.
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

  /**
   * Runs `task` after everything already queued for the window, and after any
   * drag that holds the window. Every user action on the tab strip goes
   * through here so each one sees the strip the previous one left behind.
   */
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

  /** Resolves once no drag holds the tab's window. */
  async function waitForTabDrag(tab?: Tabs.Tab): Promise<void> {
    if (tab?.windowId == null) return;
    const dragTail = tabDragTailsByWindowId.get(tab.windowId);
    if (dragTail) await dragTail;
  }

  // Ends a session and frees its window's drag slot. Safe to call for a
  // session that is already gone.
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

  /**
   * Starts a drag of the sender's tab, or refreshes the session when called
   * again with the same gestureId (the page re-sends begin as a keepalive).
   * Resolves once the drag owns its window: earlier drags have ended and the
   * cycles and click actions already queued have run.
   */
  async function beginTabDrag(
    gestureId: string,
    tab?: Tabs.Tab,
  ): Promise<TabWheelActionResult> {
    if (!gestureId || tab?.id == null || tab.windowId == null) {
      return { ok: false, reason: "Couldn't find the current tab" };
    }
    const existing = tabDragSessionsById.get(gestureId);
    if (existing) {
      if (existing.tabId !== tab.id || existing.windowId !== tab.windowId) {
        return { ok: false, reason: "That drag is no longer active" };
      }
      await existing.ready;
      if (tabDragSessionsById.get(gestureId) !== existing) {
        return { ok: false, reason: "The drag timed out" };
      }
      refreshTabDragSessionTimeout(existing);
      return { ok: true };
    }

    // Drags in a window form a chain: each session appends a promise that stays
    // pending until it is released, and the chain's tail is what new window
    // tasks wait on. The map entry is removed once the last drag in the chain
    // releases, unless a newer drag has already extended it.
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

    // Wait for the previous drag, then for tasks queued before this drag took
    // the slot. Later window tasks wait on the tail installed above instead.
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
    // The session can be released while we waited (tab closed, window closed).
    if (tabDragSessionsById.get(gestureId) !== session) {
      return { ok: false, reason: "The drag timed out" };
    }
    refreshTabDragSessionTimeout(session);
    return { ok: true };
  }

  // Ends a drag. Unknown ids are already released, which is success.
  async function endTabDrag(
    gestureId: string,
    tab?: Tabs.Tab,
  ): Promise<TabWheelActionResult> {
    const session = tabDragSessionsById.get(gestureId);
    if (!session) return { ok: true };
    if (tab?.id !== session.tabId) {
      return { ok: false, reason: "That drag is no longer active" };
    }
    releaseTabDragSession(gestureId);
    return { ok: true };
  }

  // Marks onboarding's "first real gesture" milestone. Reads first so repeat
  // gestures don't write.
  async function recordFirstGestureCycle(): Promise<void> {
    const state = await loadTabWheelOnboardingState();
    if (state.firstGestureCycleCompleted) return;
    await saveTabWheelOnboardingState({
      ...state,
      firstGestureCycleCompleted: true,
    });
  }

  // The body of a cycle. Must only run inside the window queue (see cycle).
  async function cycleUnlocked(
    direction: "prev" | "next",
    source: TabWheelCycleSource,
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    await ensureLoaded();
    const activeTab = await resolveActiveTab(tab, windowId);
    if (!activeTab?.id || activeTab.windowId == null) {
      return { ok: false, reason: "Couldn't find the current tab" };
    }
    const settings = await getSettings();
    const tabs = await getWindowTabs(activeTab.windowId);
    await reconcileRecentTabs(activeTab.windowId, tabs);
    const eligibleTabs = await getGestureEligibleTabs(tabs, settings, activeTab.windowId, activeTab);
    if (eligibleTabs.length === 0) return { ok: false, reason: "No other tabs to switch to" };

    const candidateTabs = eligibleTabs;
    const targetTab = await resolveAvailableCycleTargetTab(activeTab, candidateTabs, direction, settings);
    if (!targetTab?.id) {
      return { ok: false, reason: "No more tabs in that direction" };
    }

    // Stop any restore still running on the tab we're leaving so it can't
    // scroll the page after the user moved on, then save where they left it.
    cancelScrollRestore(activeTab.id);
    captureTabScrollUnlessWaking(activeTab, settings);
    const didActivate = await activateTab(targetTab, { restoreScrollAsync: true });
    if (!didActivate) return { ok: false, reason: "That tab was just closed" };
    // Detached on purpose. `void` keeps these probes out of the promise this
    // function returns, and that promise is the one runSerializedWindowTask
    // chains the next queued gesture on — so a second gesture starts the
    // moment this switch resolves, never behind a chain of readiness probes.
    // Awaiting here would delay both the response and the next switch.
    void warmNeighborReadiness(targetTab, candidateTabs, settings).catch(() => {});
    if (source === "gesture") {
      void recordFirstGestureCycle().catch(() => {});
    }
    return { ok: true, tabId: targetTab.id };
  }

  /**
   * Switches one eligible tab in `direction`. Serialized per window, so a
   * fast wheel burst lands each tick on the tab the previous tick reached.
   */
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

  /**
   * The window's recent tabs, most recent first, excluding the active one.
   * Unlike cycling, no eligibility filters apply: "go back" means the exact
   * tab the user was on, whatever it is.
   */
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

  // Opens Chrome's own new tab page right after the active tab, as if the
  // user had opened it from that tab.
  async function openNativeNewTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "Couldn't find the current tab" };
      }
      const createdTab = await browser.tabs.create({
        active: true,
        windowId: activeTab.windowId,
        index: getTabIndex(activeTab) + 1,
        openerTabId: activeTab.id,
      }).catch(() => null);
      if (!createdTab) return { ok: false, reason: "Couldn't open a new tab" };
      invalidateWindowTabsCache(activeTab.windowId);
      if (createdTab.id != null && createdTab.windowId != null) {
        await recordRecentTab(createdTab.id, createdTab.windowId);
      }
      return { ok: true, tabId: createdTab.id };
    });
  }

  // Returns to the previously used tab, falling back through the history if
  // the most recent one can't be activated.
  async function activateMostRecentTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "Couldn't find the current tab" };
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
      return { ok: false, reason: "No recent tab to return to" };
    });
  }

  /**
   * Closes the active tab and lands on the previously used one. The recent tab
   * is activated before the close so Chrome never briefly activates (and
   * possibly wakes) whichever neighbor it would pick on its own.
   */
  async function closeCurrentTabAndActivateRecent(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "Couldn't find the current tab" };
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
      if (!didClose) return { ok: false, reason: "Couldn't close this tab" };
      return { ok: true, tabId: activatedTabId };
    });
  }

  // Duplicates the active tab and switches to the copy.
  async function duplicateTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) {
        return { ok: false, reason: "Couldn't find the current tab" };
      }
      const duplicatedTab = await browser.tabs.duplicate(activeTab.id).catch(() => null);
      if (!duplicatedTab?.id) return { ok: false, reason: "Couldn't duplicate this tab" };
      const activatedTab = await browser.tabs.update(duplicatedTab.id, { active: true }).catch(() => null);
      if (!activatedTab) return { ok: false, reason: "Couldn't duplicate this tab" };
      invalidateWindowTabsCache(activeTab.windowId);
      await recordRecentTab(duplicatedTab.id, duplicatedTab.windowId ?? activeTab.windowId);
      return { ok: true, tabId: duplicatedTab.id };
    });
  }

  // Moves the dragged tab one slot. Must only run inside the window queue.
  // The tab never crosses the pinned/unpinned boundary or leaves its group:
  // at those edges resolveTabDragTargetIndex returns null and nothing moves.
  async function moveCurrentTabUnlocked(
    direction: TabWheelMoveDirection,
    tab?: Tabs.Tab,
  ): Promise<TabWheelMoveResult> {
    await ensureLoaded();
    if (tab?.id == null) {
      return { ok: false, moved: false, reason: "Couldn't find the current tab" };
    }
    const activeTab = await browser.tabs.get(tab.id).catch(() => null);
    if (!activeTab?.id || activeTab.windowId == null || activeTab.active !== true) {
      return { ok: false, moved: false, reason: "The current tab changed during the drag" };
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
      return { ok: false, moved: false, reason: "Couldn't move this tab" };
    }
    invalidateWindowTabsCache(activeTab.windowId);
    return {
      ok: true,
      moved: true,
      tabId: movedTab.id,
      index: movedTab.index,
    };
  }

  /**
   * One step of a tab drag. Rejected unless it comes from the tab and window
   * that began the session. Uses the raw queue: the session already holds the
   * window's drag slot, so waiting on the slot would deadlock.
   */
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
      return { ok: false, moved: false, reason: "The drag timed out" };
    }
    refreshTabDragSessionTimeout(session);
    await session.ready;
    return await runRawSerializedWindowTask(
      tab,
      session.windowId,
      () => moveCurrentTabUnlocked(direction, tab),
    );
  }

  // One-shot actions on the active tab that leave the tab strip untouched, so
  // they neither invalidate the window-tabs cache nor touch recent-tab order.
  async function toggleMuteCurrentTab(
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) return { ok: false, reason: "Couldn't find the current tab" };
      const muted = activeTab.mutedInfo?.muted === true;
      const updatedTab = await browser.tabs.update(activeTab.id, { muted: !muted }).catch(() => null);
      if (!updatedTab) return { ok: false, reason: "This tab can't be muted" };
      return { ok: true, tabId: activeTab.id };
    });
  }

  async function navigateCurrentTabHistory(
    direction: "back" | "forward",
    tab?: Tabs.Tab,
    windowId?: number,
  ): Promise<TabWheelActionResult> {
    return await runSerializedWindowTask(tab, windowId, async () => {
      await ensureLoaded();
      const activeTab = await resolveActiveTab(tab, windowId);
      if (!activeTab?.id || activeTab.windowId == null) return { ok: false, reason: "Couldn't find the current tab" };
      // The browser rejects when the history has no entry in that direction.
      const navigation = direction === "back"
        ? browser.tabs.goBack(activeTab.id)
        : browser.tabs.goForward(activeTab.id);
      const didNavigate = await navigation.then(() => true).catch(() => false);
      if (!didNavigate) return { ok: false, reason: `Nothing to go ${direction} to` };
      return { ok: true, tabId: activeTab.id };
    });
  }

  async function goBackInCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult> {
    return await navigateCurrentTabHistory("back", tab, windowId);
  }

  async function goForwardInCurrentTab(tab?: Tabs.Tab, windowId?: number): Promise<TabWheelActionResult> {
    return await navigateCurrentTabHistory("forward", tab, windowId);
  }

  /**
   * Stores a scroll position reported by a page. Unchanged reports are dropped
   * without a write, since pages report whenever scrolling settles.
   */
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
    if (!url) return { ok: false, reason: "TabWheel can't save your place on this page" };
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

  /**
   * Registers every browser event listener the domain needs. Call exactly once,
   * synchronously during the worker's first run: MV3 only delivers the waking
   * event to listeners that exist by then.
   */
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
      // Turning off "restore page position" also forgets every saved position.
      if (previousSettings.restorePagePosition && !nextSettings.restorePagePosition) {
        scrollMemoryByTabId = {};
        void browser.storage.local.remove(TABWHEEL_STORAGE_KEYS.scrollMemory).catch(() => {});
      }
    });

    browser.tabs.onCreated.addListener((createdTab: Tabs.Tab) => {
      invalidateWindowTabsCache(createdTab.windowId);
    });

    browser.tabs.onActivated.addListener((activeInfo: { tabId: number; windowId: number }) => {
      // This fires for every activation, including ones TabWheel didn't make.
      // Leaving a tab ends its wake hold and any restore still running on it.
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
      // Forget everything keyed by this tab so the per-tab maps and persisted
      // state don't accumulate closed tabs.
      await ensureLoaded();
      delete scrollMemoryByTabId[tabKey(tabId)];
      contentScriptReadyUrlsByTabId.delete(tabId);
      contentScriptUnavailableUrlsByTabId.delete(tabId);
      neighborPreprobedUntilByTabId.delete(tabId);
      scrollRestoreTokensByTabId.delete(tabId);
      clearDiscardedWakeHoldForTab(tabId);
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

    browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string; pinned?: boolean; groupId?: number; status?: string }, updatedTab?: Tabs.Tab) => {
      if (changeInfo.url || changeInfo.pinned != null || changeInfo.groupId != null) {
        invalidateWindowTabsCache(updatedTab?.windowId);
      }
      // A finished load is the normal end of a wake hold.
      if (changeInfo.status === "complete") {
        clearDiscardedWakeHoldForTab(tabId);
      }
      // A navigation invalidates both readiness caches (they are per URL) and
      // any restore aimed at the previous page.
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

    // Collapsing or expanding a group changes which tabs are eligible, so group
    // events drop the window's cached tabs and collapsed-group ids.
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

    // A closed window's ids are never coming back, so drop its drags, caches,
    // history, and saved scroll positions.
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
      // Tab and window ids don't survive a browser restart, so recent-tab
      // history and every per-tab cache from the last session are cleared.
      // Scroll memory is only trimmed: a restore also requires a URL match, so
      // an old entry can't land on the wrong page. Housekeeping is best-effort;
      // a storage failure must not skip the reinjection below.
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
    toggleMuteCurrentTab,
    goBackInCurrentTab,
    goForwardInCurrentTab,
    beginTabDrag,
    moveCurrentTab,
    endTabDrag,
    waitForTabDrag,
    resetState,
    saveScrollPosition,
    markContentScriptReady,
    registerLifecycleListeners,
  };
}
