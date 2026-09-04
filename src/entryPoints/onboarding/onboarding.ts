import browser from "webextension-polyfill";
import {
  formatTabWheelClickAction,
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
  advanceTabDragState,
  createTabDragState,
  TabDragState,
} from "../../lib/core/tabWheel/tabDragCore";
import {
  populateClickActionSelect,
  populateModifierSelect,
} from "../../lib/ui/settings/settingsControls";

document.addEventListener("DOMContentLoaded", async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let settings = await loadTabWheelSettings();
  let onboarding = await loadTabWheelOnboardingState();
  const wheelFlow = byId<HTMLElement>("wheelFlow");
  const mouseFlow = byId<HTMLElement>("mouseFlow");

  async function closeCurrentTab(): Promise<void> {
    const tab = await browser.tabs.getCurrent().catch(() => null);
    if (tab?.id != null) await browser.tabs.remove(tab.id).catch(() => {});
    else window.close();
  }

  const demo = byId<HTMLElement>("gestureDemo");
  const demoCombo = byId<HTMLElement>("demoCombo");
  const demoPrompt = byId<HTMLElement>("demoPrompt");
  const demoStatus = byId<HTMLElement>("demoStatus");
  const continueDemoBtn = byId<HTMLButtonElement>("continueDemoBtn");
  const modifierSelect = byId<HTMLSelectElement>("gestureModifier");
  const gestureWithShift = byId<HTMLInputElement>("gestureWithShift");
  const leftClickAction = byId<HTMLSelectElement>("leftClickAction");
  const middleClickAction = byId<HTMLSelectElement>("middleClickAction");
  const rightClickAction = byId<HTMLSelectElement>("rightClickAction");
  const introLeftClickAction = byId<HTMLSelectElement>("introLeftClickAction");
  const introMiddleClickAction = byId<HTMLSelectElement>("introMiddleClickAction");
  const introRightClickAction = byId<HTMLSelectElement>("introRightClickAction");
  const clickGestureDemo = byId<HTMLElement>("clickGestureDemo");
  const clickPracticePrompt = byId<HTMLElement>("clickPracticePrompt");
  const clickDemoStatus = byId<HTMLElement>("clickDemoStatus");
  const browserSimulator = byId<HTMLElement>("browserSimulator");
  const simRecentTab = byId<HTMLElement>("simRecentTab");
  const simCurrentTab = byId<HTMLElement>("simCurrentTab");
  const simResultTab = byId<HTMLElement>("simResultTab");
  const simAddress = byId<HTMLElement>("simAddress");
  const simIcon = byId<HTMLElement>("simIcon");
  const simTitle = byId<HTMLElement>("simTitle");
  const simDescription = byId<HTMLElement>("simDescription");
  const tabs = [...document.querySelectorAll<HTMLElement>(".demo-tab")];
  let demoAccumulator = 0;
  let activeDemoTab = 0;
  let mouseHighlightTimer = 0;
  let demoTabDrag: {
    pointerId: number;
    button: number;
    state: TabDragState;
    moved: boolean;
  } | null = null;
  let lastDemoTabDragMoved = false;

  const actionSelects = [leftClickAction, middleClickAction, rightClickAction] as const;
  const introActionSelects = [
    introLeftClickAction,
    introMiddleClickAction,
    introRightClickAction,
  ] as const;
  const actionHintIds = ["leftActionHint", "middleActionHint", "rightActionHint"] as const;

  function selectedAction(button: number): TabWheelClickAction {
    return (actionSelects[button]?.value || "none") as TabWheelClickAction;
  }

  function selectedModifier(): TabWheelModifierKey {
    return modifierSelect.value as TabWheelModifierKey;
  }

  function renderCombo(): void {
    const combo = formatTabWheelModifierCombo(
      selectedModifier(),
      gestureWithShift.checked,
    );
    demoCombo.textContent = combo;
    demoPrompt.textContent = `Hold ${combo} + scroll`;
    clickPracticePrompt.textContent = `Hold ${combo}, then click or drag with a mouse button here`;
    byId<HTMLElement>("clickCombo").textContent = `${combo} + mouse`;
    byId<HTMLElement>("settingsWheelCombo").textContent = `${combo} + wheel`;
  }

  function renderActionSummaries(): void {
    const hints: Record<TabWheelClickAction, string> = {
      nativeNewTab: "Open the browser's New Tab page beside the current tab.",
      recentTab: "Return to the previously active tab.",
      closeToRecent: "Close this tab and return to the previous one.",
      duplicateTab: "Copy this tab beside it and select the copy.",
      dragCurrentTab: "Hold and drag horizontally to move this tab in the strip.",
      openSettings: "Open TabWheel settings in a tab.",
      muteTab: "Mute or unmute this tab's audio.",
      goBack: "Go back one page in this tab.",
      goForward: "Go forward one page in this tab.",
      none: "Off leaves this mouse combination browser-native.",
    };
    actionSelects.forEach((select, index) => {
      byId<HTMLElement>(actionHintIds[index]).textContent =
        hints[select.value as TabWheelClickAction];
    });
  }

  function setSetupProgress(step: 1 | 2 | 3): void {
    for (const marker of document.querySelectorAll<HTMLElement>("#setupProgress [data-progress]")) {
      marker.classList.toggle("active", Number(marker.dataset.progress) <= step);
    }
  }

  function showWheelStep(step: number): void {
    for (const panel of wheelFlow.querySelectorAll<HTMLElement>("[data-wheel-step]")) {
      panel.hidden = Number(panel.dataset.wheelStep) !== step;
    }
  }

  function showMouseStep(step: number): void {
    for (const panel of mouseFlow.querySelectorAll<HTMLElement>("[data-mouse-step]")) {
      panel.hidden = Number(panel.dataset.mouseStep) !== step;
    }
  }

  function openMouseFlow(): void {
    wheelFlow.hidden = true;
    mouseFlow.hidden = false;
    showMouseStep(1);
    setSetupProgress(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnToWheelDemo(): void {
    mouseFlow.hidden = true;
    wheelFlow.hidden = false;
    showWheelStep(1);
    setSetupProgress(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function continueToWheelSettings(): void {
    mouseFlow.hidden = true;
    wheelFlow.hidden = false;
    showWheelStep(2);
    setSetupProgress(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function markDemoComplete(): Promise<void> {
    if (onboarding.demoCompleted) return;
    onboarding = { ...onboarding, demoCompleted: true };
    await saveTabWheelOnboardingState(onboarding);
  }

  function resetBrowserSimulation(): void {
    const simTabs = simCurrentTab.parentElement;
    simTabs?.append(simRecentTab, simCurrentTab, simResultTab);
    browserSimulator.dataset.state = "idle";
    simRecentTab.hidden = false;
    simRecentTab.classList.remove("active");
    simCurrentTab.hidden = false;
    simCurrentTab.classList.remove("closing");
    simCurrentTab.classList.add("active");
    simResultTab.hidden = true;
    simResultTab.classList.remove("active");
    simResultTab.textContent = "New tab";
    simAddress.textContent = "Current page";
    lastDemoTabDragMoved = false;
  }

  function renderSimulatedResult(action: TabWheelClickAction): void {
    resetBrowserSimulation();
    browserSimulator.dataset.state = action;
    const descriptions: Record<TabWheelClickAction, [string, string, string]> = {
      nativeNewTab: [
        "＋",
        "Browser New Tab selected",
        "The browser owns this page, so TabWheel gestures resume after you navigate.",
      ],
      recentTab: ["↶", "Back to Research", "The most recently active tab becomes selected."],
      closeToRecent: ["×", "Current tab closed", "Research becomes active immediately."],
      duplicateTab: ["⧉", "Current tab duplicated", "The copy opens beside the original and becomes active."],
      dragCurrentTab: ["↔", "Drag current tab", "Drag horizontally to move this tab through its strip section."],
      openSettings: ["⚙", "Settings opened", "TabWheel opens its full settings page."],
      muteTab: ["♪", "Tab muted", "Click again to unmute."],
      goBack: ["←", "Went back", "This tab shows the previous page."],
      goForward: ["→", "Went forward", "This tab shows the next page."],
      none: ["○", "Browser-native behavior", "TabWheel does not claim this mouse combination."],
    };
    const [icon, title, description] = descriptions[action];
    simIcon.textContent = icon;
    simTitle.textContent = title;
    simDescription.textContent = description;

    if (action === "nativeNewTab" || action === "duplicateTab") {
      simCurrentTab.classList.remove("active");
      simResultTab.hidden = false;
      simResultTab.classList.add("active");
      simResultTab.textContent = action === "duplicateTab" ? "Current tab copy" : "New tab";
      simAddress.textContent = action === "duplicateTab"
        ? "Current page"
        : "Browser-controlled New Tab";
    } else if (action === "recentTab" || action === "closeToRecent") {
      simCurrentTab.classList.remove("active");
      simRecentTab.classList.add("active");
      if (action === "closeToRecent") simCurrentTab.classList.add("closing");
      simAddress.textContent = "Research";
    } else if (action === "dragCurrentTab") {
      simResultTab.hidden = false;
      simResultTab.textContent = "Other tab";
    } else if (action === "openSettings") {
      simAddress.textContent = "TabWheel settings";
    } else if (action === "muteTab") {
      simAddress.textContent = "Current page · muted";
    } else if (action === "goBack" || action === "goForward") {
      simAddress.textContent = action === "goBack" ? "Previous page" : "Next page";
    }

    clickDemoStatus.textContent = `${formatTabWheelClickAction(action)} — ${description}`;
  }

  function highlightMouseButton(button: number): void {
    for (const part of document.querySelectorAll<HTMLElement>("[data-mouse-part]")) {
      part.classList.toggle("active", Number(part.dataset.mousePart) === button);
    }
    if (mouseHighlightTimer) window.clearTimeout(mouseHighlightTimer);
    mouseHighlightTimer = window.setTimeout(() => {
      for (const part of document.querySelectorAll<HTMLElement>("[data-mouse-part]")) {
        part.classList.remove("active");
      }
      mouseHighlightTimer = 0;
    }, 320);
  }

  function previewAction(action: TabWheelClickAction, button: number): void {
    highlightMouseButton(button);
    renderSimulatedResult(action);
  }

  function isConfiguredDemoGesture(event: MouseEvent): boolean {
    return isTabWheelModifier(
      event,
      selectedModifier(),
      gestureWithShift.checked,
    );
  }

  function suppressDemoEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function moveSimulatedCurrentTab(direction: "left" | "right"): boolean {
    const parent = simCurrentTab.parentElement;
    if (!parent) return false;
    const visibleTabs = [...parent.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement && !child.hidden);
    const currentIndex = visibleTabs.indexOf(simCurrentTab);
    const target = visibleTabs[currentIndex + (direction === "right" ? 1 : -1)];
    if (!target) return false;
    if (direction === "left") parent.insertBefore(simCurrentTab, target);
    else parent.insertBefore(target, simCurrentTab);
    return true;
  }

  function clickDemoPressHandler(event: MouseEvent): void {
    if (!isConfiguredDemoGesture(event)) return;
    const action = selectedAction(event.button);
    if (action === "none") return;
    suppressDemoEvent(event);
    if (
      action !== "dragCurrentTab"
      || event.type !== "pointerdown"
      || !(event instanceof PointerEvent)
      || event.pointerType !== "mouse"
    ) return;
    previewAction(action, event.button);
    demoTabDrag = {
      pointerId: event.pointerId,
      button: event.button,
      state: createTabDragState(event.clientX),
      moved: false,
    };
    lastDemoTabDragMoved = false;
    try {
      clickGestureDemo.setPointerCapture(event.pointerId);
    } catch (_) {
      // The simulator still receives movement while the pointer stays over it.
    }
  }

  function clickDemoDragMoveHandler(event: PointerEvent): void {
    const session = demoTabDrag;
    if (!session || event.pointerId !== session.pointerId) return;
    suppressDemoEvent(event);
    const advanced = advanceTabDragState(session.state, event.clientX);
    session.state = advanced.state;
    for (const direction of advanced.directions) {
      session.moved = moveSimulatedCurrentTab(direction) || session.moved;
    }
    if (session.moved) {
      clickDemoStatus.textContent =
        "Drag current tab — the active tab moves live and stays selected.";
    }
  }

  function finishClickDemoDrag(event: PointerEvent): void {
    const session = demoTabDrag;
    if (!session || event.pointerId !== session.pointerId) return;
    suppressDemoEvent(event);
    lastDemoTabDragMoved = session.moved;
    demoTabDrag = null;
    try {
      if (clickGestureDemo.hasPointerCapture(event.pointerId)) {
        clickGestureDemo.releasePointerCapture(event.pointerId);
      }
    } catch (_) {
      // Pointer capture may already have ended.
    }
    if (!lastDemoTabDragMoved) {
      clickDemoStatus.textContent =
        "Drag current tab — move horizontally at least 56 px to shift one slot.";
    }
  }

  function clickDemoActionHandler(event: MouseEvent): void {
    if (!isConfiguredDemoGesture(event)) {
      clickDemoStatus.textContent =
        `Hold ${formatTabWheelModifierCombo(
          selectedModifier(),
          gestureWithShift.checked,
        )} while clicking.`;
      return;
    }
    const action = selectedAction(event.button);
    if (action === "none") {
      renderSimulatedResult("none");
      return;
    }
    suppressDemoEvent(event);
    if (action === "dragCurrentTab") {
      if (!lastDemoTabDragMoved) {
        clickDemoStatus.textContent =
          "Drag current tab — hold the button and drag horizontally.";
      }
      return;
    }
    previewAction(action, event.button);
  }

  populateModifierSelect(modifierSelect, settings.gestureModifier);
  populateClickActionSelect(leftClickAction, settings.leftClickAction);
  populateClickActionSelect(middleClickAction, settings.middleClickAction);
  populateClickActionSelect(rightClickAction, settings.rightClickAction);
  populateClickActionSelect(introLeftClickAction, settings.leftClickAction);
  populateClickActionSelect(introMiddleClickAction, settings.middleClickAction);
  populateClickActionSelect(introRightClickAction, settings.rightClickAction);
  gestureWithShift.checked = settings.gestureWithShift;
  renderCombo();
  renderActionSummaries();

  demo.addEventListener("wheel", (event) => {
    if (!isTabWheelModifier(event, selectedModifier(), gestureWithShift.checked)) {
      demoStatus.textContent =
        `Hold ${formatTabWheelModifierCombo(selectedModifier(), gestureWithShift.checked)} while scrolling.`;
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
    demoStatus.textContent = "Perfect — that is the whole wheel gesture.";
    continueDemoBtn.disabled = false;
    void markDemoComplete();
  }, { passive: false });

  demo.addEventListener("click", () => demo.focus());
  clickGestureDemo.addEventListener("pointerdown", clickDemoPressHandler);
  clickGestureDemo.addEventListener("pointermove", clickDemoDragMoveHandler);
  clickGestureDemo.addEventListener("pointerup", finishClickDemoDrag);
  clickGestureDemo.addEventListener("pointercancel", finishClickDemoDrag);
  clickGestureDemo.addEventListener("mousedown", clickDemoPressHandler);
  clickGestureDemo.addEventListener("click", clickDemoActionHandler);
  clickGestureDemo.addEventListener("auxclick", clickDemoActionHandler);
  clickGestureDemo.addEventListener("contextmenu", clickDemoActionHandler);
  for (const previewButton of document.querySelectorAll<HTMLButtonElement>("[data-preview-button]")) {
    previewButton.addEventListener("click", () => {
      const button = Number(previewButton.dataset.previewButton);
      previewAction(selectedAction(button), button);
    });
  }
  for (const control of [modifierSelect, gestureWithShift]) {
    control.addEventListener("change", () => {
      renderCombo();
      resetBrowserSimulation();
    });
  }
  actionSelects.forEach((select, index) => {
    select.addEventListener("change", () => {
      introActionSelects[index].value = select.value;
      renderActionSummaries();
      resetBrowserSimulation();
    });
  });
  introActionSelects.forEach((select, index) => {
    select.addEventListener("change", () => {
      actionSelects[index].value = select.value;
      renderActionSummaries();
      resetBrowserSimulation();
      previewAction(selectedAction(index), index);
    });
  });

  continueDemoBtn.addEventListener("click", openMouseFlow);
  byId<HTMLButtonElement>("skipDemoBtn").addEventListener("click", openMouseFlow);
  byId<HTMLButtonElement>("wheelBackBtn").addEventListener("click", openMouseFlow);
  byId<HTMLButtonElement>("saveWheelChoicesBtn").addEventListener("click", async () => {
    const finishBtn = byId<HTMLButtonElement>("saveWheelChoicesBtn");
    if (finishBtn.disabled) return;
    finishBtn.disabled = true;
    settings = {
      ...settings,
      gestureModifier: selectedModifier(),
      gestureWithShift: gestureWithShift.checked,
      leftClickAction: leftClickAction.value as TabWheelClickAction,
      middleClickAction: middleClickAction.value as TabWheelClickAction,
      rightClickAction: rightClickAction.value as TabWheelClickAction,
    };
    try {
      await saveTabWheelSettings(settings);
      onboarding = { ...onboarding, version: 2, clickActionsReleaseSeen: true };
      await saveTabWheelOnboardingState(onboarding);
      await closeCurrentTab();
    } catch (error) {
      finishBtn.disabled = false;
      throw error;
    }
  });
  byId<HTMLButtonElement>("clickBackBtn").addEventListener("click", returnToWheelDemo);
  byId<HTMLButtonElement>("saveChoicesBtn").addEventListener("click", () => {
    continueToWheelSettings();
  });
});
