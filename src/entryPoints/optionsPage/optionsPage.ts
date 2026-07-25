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
  activateTabWheelContentScripts,
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
  const settingsTitle = byId<HTMLElement>("settingsTitle");
  const gestureModifier = byId<HTMLSelectElement>("gestureModifier");
  const gestureWithShift = byId<HTMLInputElement>("gestureWithShift");
  const middleClickAction = byId<HTMLSelectElement>("middleClickAction");
  const cycleScope = byId<HTMLSelectElement>("cycleScope");
  const wheelDirection = byId<HTMLSelectElement>("wheelDirection");
  const wheelPreset = byId<HTMLSelectElement>("wheelPreset");
  const wheelSensitivity = byId<HTMLInputElement>("wheelSensitivity");
  const wheelCooldownMs = byId<HTMLInputElement>("wheelCooldownMs");
  const wheelAcceleration = byId<HTMLInputElement>("wheelAcceleration");
  const deviceAwareTuning = byId<HTMLInputElement>("deviceAwareTuning");
  const skipPinnedTabs = byId<HTMLInputElement>("skipPinnedTabs");
  const skipHiddenTabs = byId<HTMLInputElement>("skipHiddenTabs");
  const showRestrictedBadge = byId<HTMLInputElement>("showRestrictedBadge");
  const wheelSensitivityValue = byId<HTMLElement>("wheelSensitivityValue");
  const wheelCooldownValue = byId<HTMLElement>("wheelCooldownValue");
  const statusBar = byId<HTMLElement>("statusBar");
  let settings = await loadTabWheelSettings();
  let statusTimer = 0;

  function showStatus(message: string): void {
    if (statusTimer) window.clearTimeout(statusTimer);
    statusBar.textContent = message;
    statusBar.classList.add("visible");
    statusTimer = window.setTimeout(() => statusBar.classList.remove("visible"), 2200);
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
      deviceAwareTuning: deviceAwareTuning.checked,
      skipPinnedTabs: skipPinnedTabs.checked,
      skipHiddenTabs: skipHiddenTabs.checked,
      showRestrictedBadge: showRestrictedBadge.checked,
    };
    return { ...next, wheelPreset: detectTabWheelPreset(next) };
  }

  function render(next: TabWheelSettings): void {
    settings = next;
    gestureModifier.value = next.gestureModifier;
    gestureWithShift.checked = next.gestureWithShift;
    middleClickAction.value = next.middleClickAction;
    cycleScope.value = next.cycleScope;
    wheelDirection.value = next.invertScroll ? "previous" : "next";
    wheelPreset.value = next.wheelPreset;
    wheelSensitivity.value = String(next.wheelSensitivity);
    wheelCooldownMs.value = String(next.wheelCooldownMs);
    wheelAcceleration.checked = next.wheelAcceleration;
    deviceAwareTuning.checked = next.deviceAwareTuning;
    skipPinnedTabs.checked = next.skipPinnedTabs;
    skipHiddenTabs.checked = next.skipHiddenTabs;
    showRestrictedBadge.checked = next.showRestrictedBadge;
    const combo = formatTabWheelModifierCombo(next.gestureModifier, next.gestureWithShift);
    const direction = next.invertScroll ? "previous" : "next";
    settingsTitle.textContent = `${combo} + wheel down moves through your ${direction} tabs.`;
    wheelSensitivityValue.textContent = `${next.wheelSensitivity.toFixed(1)}×`;
    wheelCooldownValue.textContent = `${Math.round(next.wheelCooldownMs)}ms`;
  }

  async function persist(next: TabWheelSettings): Promise<void> {
    settings = next;
    await saveTabWheelSettings(next);
    render(next);
    showStatus("Settings saved");
  }

  async function saveCurrent(): Promise<void> {
    await persist(readSettings());
  }

  populateModifierSelect(gestureModifier, settings.gestureModifier);
  populateMiddleClickActionSelect(middleClickAction, settings.middleClickAction);
  populateCycleScopeSelect(cycleScope, settings.cycleScope);
  populatePresetSelect(wheelPreset, settings.wheelPreset);
  wheelSensitivity.min = String(MIN_WHEEL_SENSITIVITY);
  wheelSensitivity.max = String(MAX_WHEEL_SENSITIVITY);
  wheelCooldownMs.min = String(MIN_WHEEL_COOLDOWN_MS);
  wheelCooldownMs.max = String(MAX_WHEEL_COOLDOWN_MS);
  render(settings);

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[TABWHEEL_STORAGE_KEYS.settings];
    if (change) render(normalizeTabWheelSettings(change.newValue));
  });

  for (const control of [
    gestureModifier,
    gestureWithShift,
    middleClickAction,
    cycleScope,
    wheelDirection,
    wheelAcceleration,
    deviceAwareTuning,
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

  byId<HTMLButtonElement>("resetDefaults").addEventListener("click", async () => {
    await resetTabWheelState().catch(() => {});
    render({ ...DEFAULT_TABWHEEL_SETTINGS });
    showStatus("Defaults restored");
  });
  byId<HTMLButtonElement>("refreshTabWheelBtn").addEventListener("click", async () => {
    const result = await activateTabWheelContentScripts().catch(() => null);
    showStatus(result ? `Refreshed ${result.injected} open tabs` : "Refresh failed");
  });
  byId<HTMLButtonElement>("closeOptionsBtn").addEventListener("click", async () => {
    const tab = await browser.tabs.getCurrent().catch(() => null);
    if (tab?.id != null) await browser.tabs.remove(tab.id).catch(() => {});
    else window.close();
  });
});
