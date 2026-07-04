// Options page for TabWheel settings.

import browser from "webextension-polyfill";
import {
  applyTabWheelPreset,
  DEFAULT_TABWHEEL_SETTINGS,
  describeTabWheelClickActionSentence,
  detectTabWheelPreset,
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
} from "../../lib/common/contracts/tabWheel";
import {
  populateClickActionSelect,
  populateCycleScopeSelect,
  populateModifierSelect,
  populatePresetSelect,
} from "../../lib/ui/settings/settingsControls";

document.addEventListener("DOMContentLoaded", async () => {
  const invertScrollInput = document.getElementById("invertScroll") as HTMLInputElement;
  const allowGesturesInEditableFieldsInput = document.getElementById("allowGesturesInEditableFields") as HTMLInputElement;
  const gestureModifierSelect = document.getElementById("gestureModifier") as HTMLSelectElement;
  const gestureWithShiftInput = document.getElementById("gestureWithShift") as HTMLInputElement;
  const leftClickActionSelect = document.getElementById("leftClickAction") as HTMLSelectElement;
  const middleClickActionSelect = document.getElementById("middleClickAction") as HTMLSelectElement;
  const rightClickActionSelect = document.getElementById("rightClickAction") as HTMLSelectElement;
  const cycleScopeSelect = document.getElementById("cycleScope") as HTMLSelectElement;
  const skipPinnedTabsInput = document.getElementById("skipPinnedTabs") as HTMLInputElement;
  const skipRestrictedPagesInput = document.getElementById("skipRestrictedPages") as HTMLInputElement;
  const skipHiddenTabsInput = document.getElementById("skipHiddenTabs") as HTMLInputElement;
  const wrapAroundInput = document.getElementById("wrapAround") as HTMLInputElement;
  const wheelPresetSelect = document.getElementById("wheelPreset") as HTMLSelectElement;
  const wheelAccelerationInput = document.getElementById("wheelAcceleration") as HTMLInputElement;
  const horizontalWheelInput = document.getElementById("horizontalWheel") as HTMLInputElement;
  const overshootGuardInput = document.getElementById("overshootGuard") as HTMLInputElement;
  const wheelSensitivityInput = document.getElementById("wheelSensitivity") as HTMLInputElement;
  const wheelSensitivityValue = document.getElementById("wheelSensitivityValue")!;
  const wheelCooldownInput = document.getElementById("wheelCooldownMs") as HTMLInputElement;
  const wheelCooldownValue = document.getElementById("wheelCooldownValue")!;
  const pageScrollSpeedInput = document.getElementById("pageScrollSpeedMultiplier") as HTMLInputElement;
  const pageScrollSpeedValue = document.getElementById("pageScrollSpeedValue")!;
  const pageScrollViewportCapInput = document.getElementById("pageScrollViewportCapRatio") as HTMLInputElement;
  const pageScrollViewportCapValue = document.getElementById("pageScrollViewportCapValue")!;
  const invertScrollHelp = document.getElementById("invertScrollHelp")!;
  const wheelShortcut = document.getElementById("wheelShortcut")!;
  const searchShortcut = document.getElementById("searchShortcut")!;
  const leftClickShortcutDescription = document.getElementById("leftClickShortcutDescription")!;
  const recentShortcut = document.getElementById("recentShortcut")!;
  const middleClickShortcutDescription = document.getElementById("middleClickShortcutDescription")!;
  const closeShortcut = document.getElementById("closeShortcut")!;
  const rightClickShortcutDescription = document.getElementById("rightClickShortcutDescription")!;
  const statusBar = document.getElementById("statusBar")!;
  const resetDefaultsBtn = document.getElementById("resetDefaults") as HTMLButtonElement;
  const closeOptionsBtn = document.getElementById("closeOptionsBtn") as HTMLButtonElement;

  let settings = await loadTabWheelSettings();
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  function showStatus(message: string): void {
    if (statusTimeout) clearTimeout(statusTimeout);
    statusBar.textContent = message;
    statusBar.className = "status-bar visible";
    statusTimeout = setTimeout(() => {
      statusBar.classList.remove("visible");
    }, 2500);
  }

  function readSettings(): TabWheelSettings {
    const nextSettings: TabWheelSettings = {
      ...settings,
      invertScroll: invertScrollInput.checked,
      allowGesturesInEditableFields: allowGesturesInEditableFieldsInput.checked,
      gestureModifier: gestureModifierSelect.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShiftInput.checked,
      leftClickAction: leftClickActionSelect.value as TabWheelClickAction,
      middleClickAction: middleClickActionSelect.value as TabWheelClickAction,
      rightClickAction: rightClickActionSelect.value as TabWheelClickAction,
      cycleScope: cycleScopeSelect.value as TabWheelCycleScope,
      skipPinnedTabs: skipPinnedTabsInput.checked,
      skipRestrictedPages: skipRestrictedPagesInput.checked,
      skipHiddenTabs: skipHiddenTabsInput.checked,
      wrapAround: wrapAroundInput.checked,
      wheelPreset: wheelPresetSelect.value as TabWheelPreset,
      wheelAcceleration: wheelAccelerationInput.checked,
      horizontalWheel: horizontalWheelInput.checked,
      overshootGuard: overshootGuardInput.checked,
      wheelSensitivity: Number(wheelSensitivityInput.value),
      wheelCooldownMs: Number(wheelCooldownInput.value),
      pageScrollSpeedMultiplier: Number(pageScrollSpeedInput.value),
      pageScrollViewportCapRatio: Number(pageScrollViewportCapInput.value),
    };
    return {
      ...nextSettings,
      wheelPreset: detectTabWheelPreset(nextSettings),
    };
  }

  function renderSettings(nextSettings: TabWheelSettings): void {
    settings = nextSettings;
    const gestureModifier = formatTabWheelModifierCombo(settings.gestureModifier, settings.gestureWithShift);
    invertScrollInput.checked = settings.invertScroll;
    allowGesturesInEditableFieldsInput.checked = settings.allowGesturesInEditableFields;
    gestureModifierSelect.value = settings.gestureModifier;
    gestureWithShiftInput.checked = settings.gestureWithShift;
    leftClickActionSelect.value = settings.leftClickAction;
    middleClickActionSelect.value = settings.middleClickAction;
    rightClickActionSelect.value = settings.rightClickAction;
    cycleScopeSelect.value = settings.cycleScope;
    skipPinnedTabsInput.checked = settings.skipPinnedTabs;
    skipRestrictedPagesInput.checked = settings.skipRestrictedPages;
    skipHiddenTabsInput.checked = settings.skipHiddenTabs;
    wrapAroundInput.checked = settings.wrapAround;
    wheelPresetSelect.value = settings.wheelPreset;
    wheelAccelerationInput.checked = settings.wheelAcceleration;
    horizontalWheelInput.checked = settings.horizontalWheel;
    overshootGuardInput.checked = settings.overshootGuard;
    wheelSensitivityInput.min = String(MIN_WHEEL_SENSITIVITY);
    wheelSensitivityInput.max = String(MAX_WHEEL_SENSITIVITY);
    wheelSensitivityInput.value = String(settings.wheelSensitivity);
    wheelSensitivityValue.textContent = `${settings.wheelSensitivity.toFixed(1)}x`;
    wheelCooldownInput.min = String(MIN_WHEEL_COOLDOWN_MS);
    wheelCooldownInput.max = String(MAX_WHEEL_COOLDOWN_MS);
    wheelCooldownInput.value = String(settings.wheelCooldownMs);
    wheelCooldownValue.textContent = `${Math.round(settings.wheelCooldownMs)}ms`;
    pageScrollSpeedInput.min = String(MIN_PAGE_SCROLL_SPEED_MULTIPLIER);
    pageScrollSpeedInput.max = String(MAX_PAGE_SCROLL_SPEED_MULTIPLIER);
    pageScrollSpeedInput.value = String(settings.pageScrollSpeedMultiplier);
    pageScrollSpeedValue.textContent = `${settings.pageScrollSpeedMultiplier.toFixed(1)}x`;
    pageScrollViewportCapInput.min = String(MIN_PAGE_SCROLL_VIEWPORT_CAP_RATIO);
    pageScrollViewportCapInput.max = String(MAX_PAGE_SCROLL_VIEWPORT_CAP_RATIO);
    pageScrollViewportCapInput.value = String(settings.pageScrollViewportCapRatio);
    pageScrollViewportCapValue.textContent = `${Math.round(settings.pageScrollViewportCapRatio * 100)}%`;
    invertScrollHelp.textContent = `${gestureModifier} + wheel down/right becomes previous, and ${gestureModifier} + wheel up/left becomes next.`;
    wheelShortcut.textContent = `${gestureModifier} + Wheel`;
    searchShortcut.textContent = `${gestureModifier} + Left Click`;
    leftClickShortcutDescription.textContent = describeTabWheelClickActionSentence(settings.leftClickAction);
    recentShortcut.textContent = `${gestureModifier} + Middle Click`;
    middleClickShortcutDescription.textContent = describeTabWheelClickActionSentence(settings.middleClickAction);
    closeShortcut.textContent = `${gestureModifier} + Right Click`;
    rightClickShortcutDescription.textContent = describeTabWheelClickActionSentence(settings.rightClickAction);
  }

  async function persist(nextSettings: TabWheelSettings): Promise<void> {
    settings = nextSettings;
    await saveTabWheelSettings(settings);
    renderSettings(settings);
    showStatus("Saved");
  }

  async function saveSettings(): Promise<void> {
    await persist(readSettings());
  }

  populateModifierSelect(gestureModifierSelect, settings.gestureModifier);
  populatePresetSelect(wheelPresetSelect, settings.wheelPreset);
  populateCycleScopeSelect(cycleScopeSelect, settings.cycleScope);
  populateClickActionSelect(leftClickActionSelect, settings.leftClickAction);
  populateClickActionSelect(middleClickActionSelect, settings.middleClickAction);
  populateClickActionSelect(rightClickActionSelect, settings.rightClickAction);
  renderSettings(settings);

  wheelPresetSelect.addEventListener("change", () => {
    void persist(applyTabWheelPreset(readSettings(), wheelPresetSelect.value as TabWheelPreset));
  });
  invertScrollInput.addEventListener("change", () => void saveSettings());
  allowGesturesInEditableFieldsInput.addEventListener("change", () => void saveSettings());
  gestureModifierSelect.addEventListener("change", () => void saveSettings());
  gestureWithShiftInput.addEventListener("change", () => void saveSettings());
  leftClickActionSelect.addEventListener("change", () => void saveSettings());
  middleClickActionSelect.addEventListener("change", () => void saveSettings());
  rightClickActionSelect.addEventListener("change", () => void saveSettings());
  cycleScopeSelect.addEventListener("change", () => void saveSettings());
  skipPinnedTabsInput.addEventListener("change", () => void saveSettings());
  skipRestrictedPagesInput.addEventListener("change", () => void saveSettings());
  skipHiddenTabsInput.addEventListener("change", () => void saveSettings());
  wrapAroundInput.addEventListener("change", () => void saveSettings());
  wheelAccelerationInput.addEventListener("change", () => void saveSettings());
  horizontalWheelInput.addEventListener("change", () => void saveSettings());
  overshootGuardInput.addEventListener("change", () => void saveSettings());
  wheelSensitivityInput.addEventListener("change", () => void saveSettings());
  wheelSensitivityInput.addEventListener("input", () => {
    wheelSensitivityValue.textContent = `${Number(wheelSensitivityInput.value).toFixed(1)}x`;
    wheelPresetSelect.value = "custom";
  });
  wheelCooldownInput.addEventListener("change", () => void saveSettings());
  wheelCooldownInput.addEventListener("input", () => {
    wheelCooldownValue.textContent = `${Math.round(Number(wheelCooldownInput.value))}ms`;
    wheelPresetSelect.value = "custom";
  });
  pageScrollSpeedInput.addEventListener("change", () => void saveSettings());
  pageScrollSpeedInput.addEventListener("input", () => {
    pageScrollSpeedValue.textContent = `${Number(pageScrollSpeedInput.value).toFixed(1)}x`;
    wheelPresetSelect.value = "custom";
  });
  pageScrollViewportCapInput.addEventListener("change", () => void saveSettings());
  pageScrollViewportCapInput.addEventListener("input", () => {
    pageScrollViewportCapValue.textContent = `${Math.round(Number(pageScrollViewportCapInput.value) * 100)}%`;
    wheelPresetSelect.value = "custom";
  });

  resetDefaultsBtn.addEventListener("click", async () => {
    const confirmed = window.confirm("Restore all settings to their factory defaults?");
    if (!confirmed) return;
    await persist({ ...DEFAULT_TABWHEEL_SETTINGS });
    showStatus("Defaults restored");
  });

  closeOptionsBtn.addEventListener("click", async () => {
    try {
      const tab = await browser.tabs.getCurrent();
      if (tab?.id != null) {
        await browser.tabs.remove(tab.id);
        return;
      }
    } catch (_) {}
    window.close();
  });
});
