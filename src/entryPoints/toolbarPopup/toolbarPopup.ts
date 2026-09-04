import browser from "webextension-polyfill";
import {
  applyTabWheelPreset,
  DEFAULT_TABWHEEL_SETTINGS,
  detectTabWheelPreset,
  formatTabWheelModifierCombo,
  loadTabWheelSettings,
  MAX_WHEEL_COOLDOWN_MS,
  MAX_TAB_DRAG_SENSITIVITY,
  MAX_WHEEL_SENSITIVITY,
  MIN_WHEEL_COOLDOWN_MS,
  MIN_TAB_DRAG_SENSITIVITY,
  MIN_WHEEL_SENSITIVITY,
  normalizeTabWheelSettings,
  saveTabWheelSettings,
  TABWHEEL_STORAGE_KEYS,
} from "../../lib/common/contracts/tabWheel";
import {
  activateTabWheelContentScripts,
  cycleTabWheel,
  getTabWheelOverviewWithRetry,
  resetTabWheelState,
} from "../../lib/adapters/runtime/tabWheelApi";
import {
  populateClickActionSelect,
  populateModifierSelect,
  populatePresetSelect,
} from "../../lib/ui/settings/settingsControls";
import { noticeDisplayMs } from "../../lib/common/utils/notice";

function dragSpeedLabel(sensitivity: number): string {
  if (sensitivity < 0.9) return "Slower";
  if (sensitivity > 1.2) return "Faster";
  return "Balanced";
}

document.addEventListener("DOMContentLoaded", async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const gestureLabel = byId<HTMLElement>("gestureLabel");
  const statusLabel = byId<HTMLElement>("statusLabel");
  const statusDot = byId<HTMLElement>("statusDot");
  const firstUseNote = byId<HTMLElement>("firstUseNote");
  const fallbackCard = byId<HTMLElement>("fallbackCard");
  const gestureModifier = byId<HTMLSelectElement>("gestureModifier");
  const gestureWithShift = byId<HTMLInputElement>("gestureWithShift");
  const leftClickAction = byId<HTMLSelectElement>("leftClickAction");
  const middleClickAction = byId<HTMLSelectElement>("middleClickAction");
  const rightClickAction = byId<HTMLSelectElement>("rightClickAction");
  const tabDragSensitivity = byId<HTMLInputElement>("tabDragSensitivity");
  const tabDragSensitivityValue = byId<HTMLElement>("tabDragSensitivityValue");
  const wheelDirection = byId<HTMLSelectElement>("wheelDirection");
  const wheelPreset = byId<HTMLSelectElement>("wheelPreset");
  const wheelSensitivity = byId<HTMLInputElement>("wheelSensitivity");
  const wheelCooldownMs = byId<HTMLInputElement>("wheelCooldownMs");
  const wheelAcceleration = byId<HTMLInputElement>("wheelAcceleration");
  const skipPinnedTabs = byId<HTMLInputElement>("skipPinnedTabs");
  const skipHiddenTabs = byId<HTMLInputElement>("skipHiddenTabs");
  const wrapAround = byId<HTMLInputElement>("wrapAround");
  const cycleWithinTabGroup = byId<HTMLInputElement>("cycleWithinTabGroup");
  const wheelSensitivityValue = byId<HTMLElement>("wheelSensitivityValue");
  const wheelCooldownValue = byId<HTMLElement>("wheelCooldownValue");
  const toast = byId<HTMLElement>("popupToast");
  let settings = await loadTabWheelSettings();
  let overview: TabWheelOverview | null = null;
  let toastTimer = 0;

  function showToast(message: string): void {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), noticeDisplayMs(message));
  }

  function readSettings(): TabWheelSettings {
    const next: TabWheelSettings = {
      ...settings,
      gestureModifier: gestureModifier.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShift.checked,
      leftClickAction: leftClickAction.value as TabWheelClickAction,
      middleClickAction: middleClickAction.value as TabWheelClickAction,
      rightClickAction: rightClickAction.value as TabWheelClickAction,
      tabDragSensitivity: Number(tabDragSensitivity.value),
      invertScroll: wheelDirection.value === "previous",
      wheelPreset: wheelPreset.value as TabWheelPreset,
      wheelSensitivity: Number(wheelSensitivity.value),
      wheelCooldownMs: Number(wheelCooldownMs.value),
      wheelAcceleration: wheelAcceleration.checked,
      skipPinnedTabs: skipPinnedTabs.checked,
      skipHiddenTabs: skipHiddenTabs.checked,
      wrapAround: wrapAround.checked,
      cycleWithinTabGroup: cycleWithinTabGroup.checked,
    };
    return { ...next, wheelPreset: detectTabWheelPreset(next) };
  }

  function render(next: TabWheelSettings = settings): void {
    settings = next;
    const combo = formatTabWheelModifierCombo(next.gestureModifier, next.gestureWithShift);
    const direction = next.invertScroll ? "previous" : "next";
    gestureLabel.textContent = `${combo} + wheel down moves through your ${direction} tabs.`;
    gestureModifier.value = next.gestureModifier;
    gestureWithShift.checked = next.gestureWithShift;
    leftClickAction.value = next.leftClickAction;
    middleClickAction.value = next.middleClickAction;
    rightClickAction.value = next.rightClickAction;
    tabDragSensitivity.value = String(next.tabDragSensitivity);
    tabDragSensitivityValue.textContent = dragSpeedLabel(next.tabDragSensitivity);
    wheelDirection.value = next.invertScroll ? "previous" : "next";
    wheelPreset.value = settings.wheelPreset;
    wheelSensitivity.value = String(next.wheelSensitivity);
    wheelCooldownMs.value = String(next.wheelCooldownMs);
    wheelAcceleration.checked = next.wheelAcceleration;
    skipPinnedTabs.checked = next.skipPinnedTabs;
    skipHiddenTabs.checked = next.skipHiddenTabs;
    wrapAround.checked = next.wrapAround;
    cycleWithinTabGroup.checked = next.cycleWithinTabGroup;
    wheelSensitivityValue.textContent = `${next.wheelSensitivity.toFixed(1)}×`;
    wheelCooldownValue.textContent = `${Math.round(next.wheelCooldownMs)}ms`;

    const ready = overview?.contentScriptStatus === "ready";
    statusDot.className = `status-dot ${ready ? "ready" : "unavailable"}`;
    statusLabel.textContent = ready ? "Ready on this page" : "Browser-restricted or unavailable";
    fallbackCard.hidden = ready;
    firstUseNote.hidden = !ready || overview?.firstGestureCycleCompleted === true;
  }

  async function refreshOverview(): Promise<void> {
    overview = await getTabWheelOverviewWithRetry().catch(() => null);
    render();
  }

  async function persist(next: TabWheelSettings): Promise<void> {
    settings = next;
    await saveTabWheelSettings(next);
    render(next);
    showToast("Settings saved");
  }

  async function saveCurrent(): Promise<void> {
    await persist(readSettings());
  }

  populateModifierSelect(gestureModifier, settings.gestureModifier);
  populatePresetSelect(wheelPreset, settings.wheelPreset);
  populateClickActionSelect(leftClickAction, settings.leftClickAction);
  populateClickActionSelect(middleClickAction, settings.middleClickAction);
  populateClickActionSelect(rightClickAction, settings.rightClickAction);
  wheelSensitivity.min = String(MIN_WHEEL_SENSITIVITY);
  wheelSensitivity.max = String(MAX_WHEEL_SENSITIVITY);
  tabDragSensitivity.min = String(MIN_TAB_DRAG_SENSITIVITY);
  tabDragSensitivity.max = String(MAX_TAB_DRAG_SENSITIVITY);
  wheelCooldownMs.min = String(MIN_WHEEL_COOLDOWN_MS);
  wheelCooldownMs.max = String(MAX_WHEEL_COOLDOWN_MS);
  render();

  for (const control of [
    gestureModifier,
    gestureWithShift,
    leftClickAction,
    middleClickAction,
    rightClickAction,
    wheelDirection,
    wheelAcceleration,
    skipPinnedTabs,
    skipHiddenTabs,
    wrapAround,
    cycleWithinTabGroup,
  ]) {
    control.addEventListener("change", () => void saveCurrent());
  }
  wheelPreset.addEventListener("change", () => {
    void persist(applyTabWheelPreset(readSettings(), wheelPreset.value as TabWheelPreset));
  });
  wheelSensitivity.addEventListener("input", () => {
    wheelSensitivityValue.textContent = `${Number(wheelSensitivity.value).toFixed(1)}×`;
    wheelPreset.value = "custom";
  });
  wheelSensitivity.addEventListener("change", () => void saveCurrent());
  tabDragSensitivity.addEventListener("input", () => {
    tabDragSensitivityValue.textContent = dragSpeedLabel(Number(tabDragSensitivity.value));
  });
  tabDragSensitivity.addEventListener("change", () => void saveCurrent());
  wheelCooldownMs.addEventListener("input", () => {
    wheelCooldownValue.textContent = `${Math.round(Number(wheelCooldownMs.value))}ms`;
    wheelPreset.value = "custom";
  });
  wheelCooldownMs.addEventListener("change", () => void saveCurrent());

  byId<HTMLButtonElement>("prevTabBtn").addEventListener("click", async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await cycleTabWheel("prev", "popup", activeTab?.windowId).catch(() => null);
    showToast(result?.ok ? "Previous tab" : result?.reason || "Couldn't switch tabs");
  });
  byId<HTMLButtonElement>("nextTabBtn").addEventListener("click", async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await cycleTabWheel("next", "popup", activeTab?.windowId).catch(() => null);
    showToast(result?.ok ? "Next tab" : result?.reason || "Couldn't switch tabs");
  });
  byId<HTMLButtonElement>("refreshTabWheelBtn").addEventListener("click", async () => {
    const result = await activateTabWheelContentScripts().catch(() => null);
    await refreshOverview();
    if (!result) {
      showToast("Couldn't refresh TabWheel");
      return;
    }
    const tabWord = result.injected === 1 ? "tab" : "tabs";
    showToast(`Reconnected TabWheel on ${result.injected} open ${tabWord}`);
  });
  byId<HTMLButtonElement>("resetDefaults").addEventListener("click", async () => {
    const result = await resetTabWheelState().catch(() => null);
    if (!result?.ok) {
      showToast(result?.reason || "Couldn't reset settings");
      return;
    }
    settings = await loadTabWheelSettings().catch(() => ({ ...DEFAULT_TABWHEEL_SETTINGS }));
    render(settings);
    await refreshOverview();
    showToast("Defaults restored");
  });

  const openSettings = () => {
    void browser.runtime.openOptionsPage();
    window.close();
  };
  byId<HTMLButtonElement>("settingsBtn").addEventListener("click", openSettings);

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[TABWHEEL_STORAGE_KEYS.settings];
    if (change) {
      settings = normalizeTabWheelSettings(change.newValue);
      render(settings);
    }
  });

  await refreshOverview();
});
