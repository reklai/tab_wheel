import browser from "webextension-polyfill";
import {
  applyTabWheelPreset,
  formatTabWheelModifierCombo,
  formatTabWheelPresetLabel,
  loadTabWheelOnboardingState,
  loadTabWheelSettings,
  saveTabWheelOnboardingState,
  saveTabWheelSettings,
} from "../../lib/common/contracts/tabWheel";
import {
  isTabWheelModifier,
  normalizeWheelDelta,
  resolveWheelDirection,
  resolveWheelTriggerDistance,
} from "../../lib/core/tabWheel/tabWheelCore";
import {
  addWheelSample,
  classifyWheelDevice,
  createWheelSampleWindow,
  resolveSuggestedPreset,
} from "../../lib/core/tabWheel/deviceProfileCore";
import {
  populateMiddleClickActionSelect,
  populateModifierSelect,
} from "../../lib/ui/settings/settingsControls";

// Purely presentational: no shared surface needs a device-kind label today,
// so this stays local instead of joining the enum formatters in the contract.
function formatDetectedDeviceLabel(kind: TabWheelDeviceKind): string {
  if (kind === "trackpad") return "Trackpad";
  if (kind === "freeSpinWheel") return "Free-spin wheel";
  return "Clicky wheel";
}

document.addEventListener("DOMContentLoaded", async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const mode = new URLSearchParams(window.location.search).get("mode") === "update" ? "update" : "install";
  const installFlow = byId<HTMLElement>("installFlow");
  const updateFlow = byId<HTMLElement>("updateFlow");
  let settings = await loadTabWheelSettings();
  let onboarding = await loadTabWheelOnboardingState();

  async function closeCurrentTab(): Promise<void> {
    const tab = await browser.tabs.getCurrent().catch(() => null);
    if (tab?.id != null) await browser.tabs.remove(tab.id).catch(() => {});
    else window.close();
  }

  const openSettings = () => void browser.runtime.openOptionsPage();

  if (mode === "update") {
    installFlow.hidden = true;
    updateFlow.hidden = false;
    onboarding = { ...onboarding, focusedReleaseSeen: true };
    await saveTabWheelOnboardingState(onboarding);
    byId<HTMLButtonElement>("updateSettingsBtn").addEventListener("click", openSettings);
    byId<HTMLButtonElement>("dismissUpdateBtn").addEventListener("click", () => void closeCurrentTab());
    return;
  }

  const demo = byId<HTMLElement>("gestureDemo");
  const demoCombo = byId<HTMLElement>("demoCombo");
  const demoPrompt = byId<HTMLElement>("demoPrompt");
  const demoStatus = byId<HTMLElement>("demoStatus");
  const continueDemoBtn = byId<HTMLButtonElement>("continueDemoBtn");
  const modifierSelect = byId<HTMLSelectElement>("gestureModifier");
  const gestureWithShift = byId<HTMLInputElement>("gestureWithShift");
  const middleClickAction = byId<HTMLSelectElement>("middleClickAction");
  const tabs = [...document.querySelectorAll<HTMLElement>(".demo-tab")];
  let demoAccumulator = 0;
  let activeDemoTab = 0;

  function renderCombo(): void {
    const combo = formatTabWheelModifierCombo(settings.gestureModifier, settings.gestureWithShift);
    demoCombo.textContent = combo;
    demoPrompt.textContent = `Hold ${combo} + scroll`;
    byId<HTMLElement>("readyCombo").textContent = `${combo} + wheel`;
  }

  function showStep(step: number): void {
    for (const panel of document.querySelectorAll<HTMLElement>("[data-step]")) {
      panel.hidden = Number(panel.dataset.step) !== step;
    }
    for (const marker of document.querySelectorAll<HTMLElement>("[data-progress]")) {
      marker.classList.toggle("active", Number(marker.dataset.progress) <= step);
    }
  }

  async function markDemoComplete(): Promise<void> {
    if (onboarding.demoCompleted) return;
    onboarding = { ...onboarding, demoCompleted: true };
    await saveTabWheelOnboardingState(onboarding);
  }

  populateModifierSelect(modifierSelect, settings.gestureModifier);
  populateMiddleClickActionSelect(middleClickAction, settings.middleClickAction);
  gestureWithShift.checked = settings.gestureWithShift;
  renderCombo();

  demo.addEventListener("wheel", (event) => {
    if (!isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)) {
      demoStatus.textContent = `Hold ${formatTabWheelModifierCombo(settings.gestureModifier, settings.gestureWithShift)} while scrolling.`;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    demoAccumulator += normalizeWheelDelta(event, demo.clientHeight, demo.clientWidth, false);
    const triggerDistance = resolveWheelTriggerDistance(80, settings.wheelSensitivity);
    if (Math.abs(demoAccumulator) < triggerDistance) return;
    const movement = resolveWheelDirection(demoAccumulator, settings.invertScroll) === "next" ? 1 : -1;
    activeDemoTab = (activeDemoTab + movement + tabs.length) % tabs.length;
    tabs.forEach((tab, index) => tab.classList.toggle("active", index === activeDemoTab));
    demoAccumulator = 0;
    demo.classList.add("success");
    demoStatus.textContent = "Perfect — that is the whole gesture.";
    continueDemoBtn.disabled = false;
    void markDemoComplete();
  }, { passive: false });

  demo.addEventListener("click", () => demo.focus());
  continueDemoBtn.addEventListener("click", () => showStep(2));
  byId<HTMLButtonElement>("skipDemoBtn").addEventListener("click", () => showStep(2));

  // Calibration evidence lives here only: in-memory for this page, never
  // persisted, never messaged. Mirrors how the content script's own sample
  // window feeds classifyWheelDevice (see appInit.ts), but sourced from
  // natural, unmodified scrolling instead of the gesture chord.
  const calibrationSampleRegion = byId<HTMLElement>("calibrationSampleRegion");
  const calibrationResult = byId<HTMLElement>("calibrationResult");
  const useSuggestedFeelBtn = byId<HTMLButtonElement>("useSuggestedFeelBtn");
  const calibrationSampleWindow = createWheelSampleWindow();
  const CALIBRATION_MIN_SAMPLES = 12;
  let calibrationObservedCount = 0;
  let suggestedDevicePreset: TabWheelPreset | null = null;

  function renderCalibrationResult(kind: TabWheelDeviceKind): void {
    calibrationResult.hidden = false;
    if (kind === "unknown") {
      suggestedDevicePreset = null;
      calibrationResult.textContent = "Couldn't detect a specific device — the Balanced default works well.";
      useSuggestedFeelBtn.hidden = true;
      return;
    }
    suggestedDevicePreset = resolveSuggestedPreset(kind);
    calibrationResult.textContent =
      `Detected: ${formatDetectedDeviceLabel(kind)} — we suggest the ${formatTabWheelPresetLabel(suggestedDevicePreset)} feel.`;
    useSuggestedFeelBtn.hidden = false;
  }

  calibrationSampleRegion.addEventListener("wheel", (event) => {
    const magnitudePx = Math.abs(normalizeWheelDelta(
      event,
      calibrationSampleRegion.clientHeight,
      calibrationSampleRegion.clientWidth,
      true,
    ));
    // A zero-magnitude sample carries no cadence evidence — it must not count
    // toward CALIBRATION_MIN_SAMPLES, the same rule the live content script
    // applies in appInit.ts.
    if (magnitudePx === 0) return;
    addWheelSample(calibrationSampleWindow, {
      timeStampMs: Date.now(),
      deltaMode: event.deltaMode,
      deltaMagnitudePx: magnitudePx,
    });
    calibrationObservedCount += 1;
    if (calibrationObservedCount < CALIBRATION_MIN_SAMPLES) return;
    renderCalibrationResult(classifyWheelDevice(calibrationSampleWindow));
  }, { passive: true });

  byId<HTMLButtonElement>("skipCalibrationBtn").addEventListener("click", () => showStep(3));
  useSuggestedFeelBtn.addEventListener("click", async () => {
    if (!suggestedDevicePreset) return;
    settings = applyTabWheelPreset(settings, suggestedDevicePreset);
    await saveTabWheelSettings(settings);
    showStep(3);
  });

  byId<HTMLButtonElement>("saveChoicesBtn").addEventListener("click", async () => {
    settings = {
      ...settings,
      gestureModifier: modifierSelect.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShift.checked,
      middleClickAction: middleClickAction.value as TabWheelMiddleClickAction,
    };
    await saveTabWheelSettings(settings);
    renderCombo();
    showStep(4);
  });
  document.querySelector<HTMLButtonElement>("[data-back='2']")?.addEventListener("click", () => showStep(2));
  byId<HTMLButtonElement>("openSettingsBtn").addEventListener("click", openSettings);
  byId<HTMLButtonElement>("finishBtn").addEventListener("click", async () => {
    onboarding = { ...onboarding, version: 1 };
    await saveTabWheelOnboardingState(onboarding);
    await closeCurrentTab();
  });
});
