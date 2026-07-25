import browser from "webextension-polyfill";
import {
  formatTabWheelModifierCombo,
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
  populateMiddleClickActionSelect,
  populateModifierSelect,
} from "../../lib/ui/settings/settingsControls";

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
    demoStatus.textContent = "Perfect — that is the whole gesture, and it works anywhere on a page.";
    continueDemoBtn.disabled = false;
    void markDemoComplete();
  }, { passive: false });

  demo.addEventListener("click", () => demo.focus());
  continueDemoBtn.addEventListener("click", () => showStep(2));
  byId<HTMLButtonElement>("skipDemoBtn").addEventListener("click", () => showStep(2));

  byId<HTMLButtonElement>("saveChoicesBtn").addEventListener("click", async () => {
    settings = {
      ...settings,
      gestureModifier: modifierSelect.value as TabWheelModifierKey,
      gestureWithShift: gestureWithShift.checked,
      middleClickAction: middleClickAction.value as TabWheelMiddleClickAction,
    };
    await saveTabWheelSettings(settings);
    renderCombo();
    showStep(3);
  });
  document.querySelector<HTMLButtonElement>("[data-back='1']")?.addEventListener("click", () => showStep(1));
  byId<HTMLButtonElement>("openSettingsBtn").addEventListener("click", openSettings);
  byId<HTMLButtonElement>("finishBtn").addEventListener("click", async () => {
    onboarding = { ...onboarding, version: 1 };
    await saveTabWheelOnboardingState(onboarding);
    await closeCurrentTab();
  });
});
