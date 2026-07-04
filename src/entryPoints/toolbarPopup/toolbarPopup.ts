// Browser-action popup for TabWheel controls.

import browser from "webextension-polyfill";
import {
  applyTabWheelPreset,
  detectTabWheelPreset,
  formatTabWheelClickActionLabel,
  formatTabWheelCycleScopeLabel,
  formatTabWheelModifierCombo,
  loadTabWheelSettings,
  MAX_PAGE_SCROLL_SPEED_MULTIPLIER,
  MAX_PAGE_SCROLL_VIEWPORT_CAP_RATIO,
  MAX_WHEEL_COOLDOWN_MS,
  MAX_WHEEL_SENSITIVITY,
  MIN_PAGE_SCROLL_SPEED_MULTIPLIER,
  MIN_PAGE_SCROLL_VIEWPORT_CAP_RATIO,
  MIN_WHEEL_COOLDOWN_MS,
  MIN_WHEEL_SENSITIVITY,
  saveTabWheelSettings,
  summarizeTabWheelClickAction,
} from "../../lib/common/contracts/tabWheel";
import {
  activateMostRecentTabWheelTab,
  closeCurrentTabWheelTabAndActivateRecent,
  cycleTabWheel,
  getTabWheelOverview,
  getTabWheelOverviewWithRetry,
  openTabWheelHelp,
  openTabWheelSearchTab,
  refreshCurrentTabWheel,
  setTabWheelCycleScope,
} from "../../lib/adapters/runtime/tabWheelApi";
import { createDebouncedCallback } from "../../lib/common/utils/asyncFlow";
import {
  populateClickActionSelect,
  populateModifierSelect,
  populatePresetSelect,
} from "../../lib/ui/settings/settingsControls";

const EXTENSION_TITLE = "Scroll Wheel Tab Switcher";
const OVERVIEW_REFRESH_DEBOUNCE_MS = 300;

function buildReadySummary(settings: TabWheelSettings): string {
  const clickSummaries: ReadonlyArray<[string, TabWheelClickAction]> = [
    ["Left-click", settings.leftClickAction],
    ["Middle-click", settings.middleClickAction],
    ["Right-click", settings.rightClickAction],
  ];
  const sentences = ["Wheel switches tab."];
  for (const [buttonLabel, clickAction] of clickSummaries) {
    const phrase = summarizeTabWheelClickAction(clickAction);
    if (phrase) sentences.push(`${buttonLabel} ${phrase}.`);
  }
  return sentences.join(" ");
}

document.addEventListener("DOMContentLoaded", async () => {
  const shortcutEl = document.getElementById("shortcutLabel")!;
  const shortcutStatusEl = document.getElementById("shortcutStatus")!;
  const fallbackPanel = document.getElementById("fallbackPanel")!;
  const toastEl = document.getElementById("popupToast")!;
  const titlebarTextEl = document.getElementById("titlebarText")!;
  const refreshTabWheelBtn = document.getElementById("refreshTabWheelBtn") as HTMLButtonElement;
  const scopeLabel = document.getElementById("scopeLabel")!;
  const generalModeBtn = document.getElementById("generalModeBtn") as HTMLButtonElement;
  const mruModeBtn = document.getElementById("mruModeBtn") as HTMLButtonElement;
  const leftClickActionLabel = document.getElementById("leftClickActionLabel")!;
  const leftClickActionSelect = document.getElementById("leftClickAction") as HTMLSelectElement;
  const middleClickActionSelect = document.getElementById("middleClickAction") as HTMLSelectElement;
  const rightClickActionSelect = document.getElementById("rightClickAction") as HTMLSelectElement;
  const prevTabBtn = document.getElementById("prevTabBtn") as HTMLButtonElement;
  const nextTabBtn = document.getElementById("nextTabBtn") as HTMLButtonElement;
  const searchForm = document.getElementById("searchForm") as HTMLFormElement;
  const searchQueryInput = document.getElementById("searchQueryInput") as HTMLInputElement;
  const recentTabBtn = document.getElementById("recentTabBtn") as HTMLButtonElement;
  const closeRecentBtn = document.getElementById("closeRecentBtn") as HTMLButtonElement;
  const wheelPresetSelect = document.getElementById("wheelPreset") as HTMLSelectElement;
  const gestureModifierSelect = document.getElementById("gestureModifier") as HTMLSelectElement;
  const gestureWithShiftInput = document.getElementById("gestureWithShift") as HTMLInputElement;
  const invertScrollInput = document.getElementById("invertScroll") as HTMLInputElement;
  const skipPinnedTabsInput = document.getElementById("skipPinnedTabs") as HTMLInputElement;
  const skipRestrictedPagesInput = document.getElementById("skipRestrictedPages") as HTMLInputElement;
  const skipHiddenTabsInput = document.getElementById("skipHiddenTabs") as HTMLInputElement;
  const wrapAroundInput = document.getElementById("wrapAround") as HTMLInputElement;
  const wheelAccelerationInput = document.getElementById("wheelAcceleration") as HTMLInputElement;
  const horizontalWheelInput = document.getElementById("horizontalWheel") as HTMLInputElement;
  const overshootGuardInput = document.getElementById("overshootGuard") as HTMLInputElement;
  const allowEditableInput = document.getElementById("allowGesturesInEditableFields") as HTMLInputElement;
  const wheelSensitivityInput = document.getElementById("wheelSensitivity") as HTMLInputElement;
  const wheelSensitivityValue = document.getElementById("wheelSensitivityValue")!;
  const wheelCooldownInput = document.getElementById("wheelCooldownMs") as HTMLInputElement;
  const wheelCooldownValue = document.getElementById("wheelCooldownValue")!;
  const pageScrollSpeedInput = document.getElementById("pageScrollSpeedMultiplier") as HTMLInputElement;
  const pageScrollSpeedValue = document.getElementById("pageScrollSpeedValue")!;
  const pageScrollViewportCapInput = document.getElementById("pageScrollViewportCapRatio") as HTMLInputElement;
  const pageScrollViewportCapValue = document.getElementById("pageScrollViewportCapValue")!;
  const helpBtn = document.getElementById("helpBtn") as HTMLButtonElement;
  const settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;

  let settings = await loadTabWheelSettings();
  let overview: TabWheelOverview | null = null;
  let statusTimer = 0;

  function clearStatusTimer(): void {
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = 0;
  }

  function hideStatus(): void {
    clearStatusTimer();
    toastEl.classList.remove("is-visible");
    toastEl.textContent = "";
  }

  function showStatus(message: string, sticky = false): void {
    clearStatusTimer();
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    if (sticky) return;
    statusTimer = window.setTimeout(() => {
      hideStatus();
    }, 1800);
  }

  async function refreshOverview(): Promise<void> {
    overview = await getTabWheelOverviewWithRetry().catch(() => null);
  }

  function renderModeButtons(cycleScope: TabWheelCycleScope): void {
    for (const button of [generalModeBtn, mruModeBtn]) {
      const isActive = button.dataset.cycleScope === cycleScope;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  function renderClickActionControls(): void {
    leftClickActionLabel.textContent = formatTabWheelClickActionLabel(settings.leftClickAction);
    leftClickActionSelect.value = settings.leftClickAction;
    middleClickActionSelect.value = settings.middleClickAction;
    rightClickActionSelect.value = settings.rightClickAction;
  }

  function renderState(): void {
    const gesture = formatTabWheelModifierCombo(settings.gestureModifier, settings.gestureWithShift);
    const cycleScope = overview?.cycleScope || settings.cycleScope;
    shortcutEl.textContent = `Hold ${gesture} and Use Mouse Wheel or Clicks`;
    titlebarTextEl.textContent = EXTENSION_TITLE;
    scopeLabel.textContent = formatTabWheelCycleScopeLabel(cycleScope);
    renderModeButtons(cycleScope);
    renderClickActionControls();
    const arePageShortcutsReady = overview?.contentScriptStatus === "ready";
    fallbackPanel.hidden = arePageShortcutsReady;
    shortcutStatusEl.hidden = !arePageShortcutsReady;
    shortcutStatusEl.textContent = arePageShortcutsReady ? buildReadySummary(settings) : "";
  }

  function renderSettings(): void {
    populatePresetSelect(wheelPresetSelect, settings.wheelPreset);
    populateModifierSelect(gestureModifierSelect, settings.gestureModifier);
    gestureWithShiftInput.checked = settings.gestureWithShift;
    invertScrollInput.checked = settings.invertScroll;
    skipPinnedTabsInput.checked = settings.skipPinnedTabs;
    skipRestrictedPagesInput.checked = settings.skipRestrictedPages;
    skipHiddenTabsInput.checked = settings.skipHiddenTabs;
    wrapAroundInput.checked = settings.wrapAround;
    wheelAccelerationInput.checked = settings.wheelAcceleration;
    horizontalWheelInput.checked = settings.horizontalWheel;
    overshootGuardInput.checked = settings.overshootGuard;
    allowEditableInput.checked = settings.allowGesturesInEditableFields;
    wheelSensitivityInput.min = String(MIN_WHEEL_SENSITIVITY);
    wheelSensitivityInput.max = String(MAX_WHEEL_SENSITIVITY);
    wheelSensitivityInput.value = String(settings.wheelSensitivity);
    wheelSensitivityValue.textContent = `Wheel distance: ${settings.wheelSensitivity.toFixed(1)}x`;
    wheelCooldownInput.min = String(MIN_WHEEL_COOLDOWN_MS);
    wheelCooldownInput.max = String(MAX_WHEEL_COOLDOWN_MS);
    wheelCooldownInput.value = String(settings.wheelCooldownMs);
    wheelCooldownValue.textContent = `Switch delay: ${Math.round(settings.wheelCooldownMs)}ms`;
    pageScrollSpeedInput.min = String(MIN_PAGE_SCROLL_SPEED_MULTIPLIER);
    pageScrollSpeedInput.max = String(MAX_PAGE_SCROLL_SPEED_MULTIPLIER);
    pageScrollSpeedInput.value = String(settings.pageScrollSpeedMultiplier);
    pageScrollSpeedValue.textContent = `Page speed: ${settings.pageScrollSpeedMultiplier.toFixed(1)}x`;
    pageScrollViewportCapInput.min = String(MIN_PAGE_SCROLL_VIEWPORT_CAP_RATIO);
    pageScrollViewportCapInput.max = String(MAX_PAGE_SCROLL_VIEWPORT_CAP_RATIO);
    pageScrollViewportCapInput.value = String(settings.pageScrollViewportCapRatio);
    pageScrollViewportCapValue.textContent = `Max step: ${Math.round(settings.pageScrollViewportCapRatio * 100)}%`;
  }

  async function refreshAll(): Promise<void> {
    settings = await loadTabWheelSettings();
    await refreshOverview();
    renderSettings();
    renderState();
  }

  const scheduleOverviewRefresh = createDebouncedCallback(() => {
    void getTabWheelOverview()
      .then((nextOverview) => {
        overview = nextOverview;
        renderState();
      })
      .catch(() => {});
  }, OVERVIEW_REFRESH_DEBOUNCE_MS);

  async function persist(nextSettings: TabWheelSettings): Promise<void> {
    settings = nextSettings;
    await saveTabWheelSettings(settings);
    renderSettings();
    renderState();
    showStatus("Saved");
    scheduleOverviewRefresh();
  }

  async function runPopupAction(
    action: () => Promise<TabWheelActionResult>,
    successMessage: string,
    failureMessage: string,
    shouldClose = false,
  ): Promise<void> {
    const result = await action().catch(() => ({
      ok: false,
      reason: failureMessage,
    }));
    await refreshAll();
    if (!result.ok) {
      showStatus(result.reason || failureMessage);
      return;
    }
    if (shouldClose) {
      window.close();
      return;
    }
    showStatus(successMessage);
  }

  async function setPopupCycleScope(cycleScope: TabWheelCycleScope): Promise<void> {
    const result: TabWheelActionResult = await setTabWheelCycleScope(cycleScope, undefined, {
      suppressPageStatus: true,
    }).catch(() => ({
      ok: false,
      reason: "Mode switch failed",
    }));
    await refreshAll();
    showStatus(result.ok ? `Mode: ${formatTabWheelCycleScopeLabel(result.cycleScope || cycleScope)}` : result.reason || "Mode switch failed");
  }

  async function refreshCurrentTabWheelState(): Promise<void> {
    refreshTabWheelBtn.disabled = true;
    try {
      const result = await refreshCurrentTabWheel();
      settings = await loadTabWheelSettings();
      overview = result.overview || await getTabWheelOverviewWithRetry().catch(() => null);
      renderSettings();
      renderState();
      showStatus(result.ok ? "TabWheel refreshed" : result.reason || "TabWheel cannot run on this page.");
    } catch (_) {
      await refreshAll();
      showStatus("TabWheel refresh failed");
    } finally {
      refreshTabWheelBtn.disabled = false;
    }
  }

  function readSettings(): TabWheelSettings {
    const nextSettings: TabWheelSettings = {
      ...settings,
      wheelPreset: wheelPresetSelect.value as TabWheelPreset,
      gestureModifier: gestureModifierSelect.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShiftInput.checked,
      invertScroll: invertScrollInput.checked,
      skipPinnedTabs: skipPinnedTabsInput.checked,
      skipRestrictedPages: skipRestrictedPagesInput.checked,
      skipHiddenTabs: skipHiddenTabsInput.checked,
      wrapAround: wrapAroundInput.checked,
      wheelAcceleration: wheelAccelerationInput.checked,
      horizontalWheel: horizontalWheelInput.checked,
      overshootGuard: overshootGuardInput.checked,
      allowGesturesInEditableFields: allowEditableInput.checked,
      wheelSensitivity: Number(wheelSensitivityInput.value),
      wheelCooldownMs: Number(wheelCooldownInput.value),
      pageScrollSpeedMultiplier: Number(pageScrollSpeedInput.value),
      pageScrollViewportCapRatio: Number(pageScrollViewportCapInput.value),
      leftClickAction: leftClickActionSelect.value as TabWheelClickAction,
      middleClickAction: middleClickActionSelect.value as TabWheelClickAction,
      rightClickAction: rightClickActionSelect.value as TabWheelClickAction,
    };
    return {
      ...nextSettings,
      wheelPreset: detectTabWheelPreset(nextSettings),
    };
  }

  populateClickActionSelect(leftClickActionSelect, settings.leftClickAction);
  populateClickActionSelect(middleClickActionSelect, settings.middleClickAction);
  populateClickActionSelect(rightClickActionSelect, settings.rightClickAction);

  [
    gestureModifierSelect,
    leftClickActionSelect,
    middleClickActionSelect,
    rightClickActionSelect,
    gestureWithShiftInput,
    invertScrollInput,
    skipPinnedTabsInput,
    skipRestrictedPagesInput,
    skipHiddenTabsInput,
    wrapAroundInput,
    wheelAccelerationInput,
    horizontalWheelInput,
    overshootGuardInput,
    allowEditableInput,
    wheelSensitivityInput,
    wheelCooldownInput,
    pageScrollSpeedInput,
    pageScrollViewportCapInput,
  ].forEach((control) => {
    control.addEventListener("change", () => void persist(readSettings()));
  });

  wheelPresetSelect.addEventListener("change", () => {
    void persist(applyTabWheelPreset(readSettings(), wheelPresetSelect.value as TabWheelPreset));
  });
  wheelSensitivityInput.addEventListener("input", () => {
    wheelSensitivityValue.textContent = `Wheel distance: ${Number(wheelSensitivityInput.value).toFixed(1)}x`;
    wheelPresetSelect.value = "custom";
  });
  wheelCooldownInput.addEventListener("input", () => {
    wheelCooldownValue.textContent = `Switch delay: ${Math.round(Number(wheelCooldownInput.value))}ms`;
    wheelPresetSelect.value = "custom";
  });
  pageScrollSpeedInput.addEventListener("input", () => {
    pageScrollSpeedValue.textContent = `Page speed: ${Number(pageScrollSpeedInput.value).toFixed(1)}x`;
    wheelPresetSelect.value = "custom";
  });
  pageScrollViewportCapInput.addEventListener("input", () => {
    pageScrollViewportCapValue.textContent = `Max step: ${Math.round(Number(pageScrollViewportCapInput.value) * 100)}%`;
    wheelPresetSelect.value = "custom";
  });

  generalModeBtn.addEventListener("click", () => {
    void setPopupCycleScope("general");
  });
  mruModeBtn.addEventListener("click", () => {
    void setPopupCycleScope("mru");
  });

  prevTabBtn.addEventListener("click", () => {
    void runPopupAction(
      () => cycleTabWheel("prev"),
      "Previous tab",
      "Unable to switch tabs",
    );
  });
  nextTabBtn.addEventListener("click", () => {
    void runPopupAction(
      () => cycleTabWheel("next"),
      "Next tab",
      "Unable to switch tabs",
    );
  });
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPopupAction(
      () => openTabWheelSearchTab(searchQueryInput.value),
      "Opened search",
      "Unable to open search",
      true,
    );
  });
  recentTabBtn.addEventListener("click", () => {
    void runPopupAction(
      () => activateMostRecentTabWheelTab(),
      "Most Recent Tab",
      "Recent tab unavailable",
      true,
    );
  });
  closeRecentBtn.addEventListener("click", () => {
    void runPopupAction(
      () => closeCurrentTabWheelTabAndActivateRecent(),
      "",
      "Unable to close tab",
      true,
    );
  });

  refreshTabWheelBtn.addEventListener("click", () => {
    void refreshCurrentTabWheelState();
  });

  helpBtn.addEventListener("click", async () => {
    const result = await openTabWheelHelp();
    if (!result.ok) {
      showStatus(result.reason || "Help unavailable on this page");
      return;
    }
    window.close();
  });

  settingsBtn.addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  const closePopupBtn = document.getElementById("closePopupBtn") as HTMLButtonElement;
  closePopupBtn.addEventListener("click", () => {
    window.close();
  });

  await refreshAll();
});
