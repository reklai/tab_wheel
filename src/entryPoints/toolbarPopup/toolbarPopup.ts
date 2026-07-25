import browser from "webextension-polyfill";
import {
  applyTabWheelPreset,
  DEFAULT_TABWHEEL_SETTINGS,
  detectTabWheelPreset,
  formatTabWheelModifierCombo,
  loadTabWheelSettings,
  MAX_WHEEL_COOLDOWN_MS,
  MAX_WHEEL_SENSITIVITY,
  MIN_WHEEL_COOLDOWN_MS,
  MIN_WHEEL_SENSITIVITY,
  normalizeTabWheelSettings,
  saveTabWheelSettings,
  TABWHEEL_STORAGE_KEYS,
} from "../../lib/common/contracts/tabWheel";
import {
  cycleTabWheel,
  getTabWheelOverviewWithRetry,
  refreshCurrentTabWheel,
  resetTabWheelState,
} from "../../lib/adapters/runtime/tabWheelApi";
import {
  populateCycleScopeSelect,
  populateMiddleClickActionSelect,
  populateModifierSelect,
  populatePresetSelect,
} from "../../lib/ui/settings/settingsControls";

document.addEventListener("DOMContentLoaded", async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const gestureLabel = byId<HTMLElement>("gestureLabel");
  const statusLabel = byId<HTMLElement>("statusLabel");
  const statusDot = byId<HTMLElement>("statusDot");
  const firstUseNote = byId<HTMLElement>("firstUseNote");
  const fallbackCard = byId<HTMLElement>("fallbackCard");
  const gestureModifier = byId<HTMLSelectElement>("gestureModifier");
  const gestureWithShift = byId<HTMLInputElement>("gestureWithShift");
  const middleClickAction = byId<HTMLSelectElement>("middleClickAction");
  const cycleScope = byId<HTMLSelectElement>("cycleScope");
  const wheelDirection = byId<HTMLSelectElement>("wheelDirection");
  const wheelPreset = byId<HTMLSelectElement>("wheelPreset");
  const wheelSensitivity = byId<HTMLInputElement>("wheelSensitivity");
  const wheelCooldownMs = byId<HTMLInputElement>("wheelCooldownMs");
  const wheelAcceleration = byId<HTMLInputElement>("wheelAcceleration");
  const skipPinnedTabs = byId<HTMLInputElement>("skipPinnedTabs");
  const skipHiddenTabs = byId<HTMLInputElement>("skipHiddenTabs");
  const showRestrictedBadge = byId<HTMLInputElement>("showRestrictedBadge");
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
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1800);
  }

  function readSettings(): TabWheelSettings {
    const next: TabWheelSettings = {
      ...settings,
      gestureModifier: gestureModifier.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShift.checked,
      middleClickAction: middleClickAction.value as TabWheelMiddleClickAction,
      cycleScope: cycleScope.value as TabWheelCycleScope,
      invertScroll: wheelDirection.value === "previous",
      wheelPreset: wheelPreset.value as TabWheelPreset,
      wheelSensitivity: Number(wheelSensitivity.value),
      wheelCooldownMs: Number(wheelCooldownMs.value),
      wheelAcceleration: wheelAcceleration.checked,
      skipPinnedTabs: skipPinnedTabs.checked,
      skipHiddenTabs: skipHiddenTabs.checked,
      showRestrictedBadge: showRestrictedBadge.checked,
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
    middleClickAction.value = next.middleClickAction;
    cycleScope.value = next.cycleScope;
    wheelDirection.value = next.invertScroll ? "previous" : "next";
    wheelPreset.value = settings.wheelPreset;
    wheelSensitivity.value = String(next.wheelSensitivity);
    wheelCooldownMs.value = String(next.wheelCooldownMs);
    wheelAcceleration.checked = next.wheelAcceleration;
    skipPinnedTabs.checked = next.skipPinnedTabs;
    skipHiddenTabs.checked = next.skipHiddenTabs;
    showRestrictedBadge.checked = next.showRestrictedBadge;
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
  populateCycleScopeSelect(cycleScope, settings.cycleScope);
  populatePresetSelect(wheelPreset, settings.wheelPreset);
  populateMiddleClickActionSelect(middleClickAction, settings.middleClickAction);
  wheelSensitivity.min = String(MIN_WHEEL_SENSITIVITY);
  wheelSensitivity.max = String(MAX_WHEEL_SENSITIVITY);
  wheelCooldownMs.min = String(MIN_WHEEL_COOLDOWN_MS);
  wheelCooldownMs.max = String(MAX_WHEEL_COOLDOWN_MS);
  render();

  for (const control of [
    gestureModifier,
    gestureWithShift,
    middleClickAction,
    cycleScope,
    wheelDirection,
    wheelAcceleration,
    skipPinnedTabs,
    skipHiddenTabs,
    showRestrictedBadge,
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
  wheelCooldownMs.addEventListener("input", () => {
    wheelCooldownValue.textContent = `${Math.round(Number(wheelCooldownMs.value))}ms`;
    wheelPreset.value = "custom";
  });
  wheelCooldownMs.addEventListener("change", () => void saveCurrent());

  byId<HTMLButtonElement>("prevTabBtn").addEventListener("click", async () => {
    const result = await cycleTabWheel("prev", "popup").catch(() => null);
    showToast(result?.ok ? "Previous tab" : result?.reason || "Unable to switch");
  });
  byId<HTMLButtonElement>("nextTabBtn").addEventListener("click", async () => {
    const result = await cycleTabWheel("next", "popup").catch(() => null);
    showToast(result?.ok ? "Next tab" : result?.reason || "Unable to switch");
  });
  byId<HTMLButtonElement>("refreshTabWheelBtn").addEventListener("click", async () => {
    const result = await refreshCurrentTabWheel().catch(() => null);
    showToast(result?.ok ? "TabWheel is ready" : result?.reason || "Still unavailable");
    await refreshOverview();
  });
  byId<HTMLButtonElement>("resetDefaults").addEventListener("click", async () => {
    const result = await resetTabWheelState().catch(() => null);
    if (!result?.ok) {
      showToast(result?.reason || "Reset failed");
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
