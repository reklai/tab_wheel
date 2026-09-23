// Onboarding page, opened by the background on install and on updates from
// before v4. It walks through three steps, tracked by a shared progress bar:
//   1. Wheel demo (#wheelFlow, step 1): hold the modifier and scroll a fake tab
//      strip, measured like the real gesture.
//   2. Mouse actions (#mouseFlow): pick an action per mouse button and try it
//      on a simulated browser window, including a live "drag current tab".
//   3. Shared settings (#wheelFlow, step 2): confirm the modifier and click
//      actions, then save and close the tab.
// Choices stay local to the page until step 3 saves them; only the demo's
// completion flag is persisted earlier.

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
  measureWheelInput,
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

  /**
   * Closes this onboarding tab. Pages cannot window.close() a tab they did not
   * open, so remove it through the tabs API and fall back to window.close().
   */
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

  // Indexed by MouseEvent.button: 0 left, 1 middle, 2 right. The step 2 "intro"
  // selects and the step 3 selects are two views of the same three choices and
  // are kept in sync below.
  const actionSelects = [leftClickAction, middleClickAction, rightClickAction] as const;
  const introActionSelects = [
    introLeftClickAction,
    introMiddleClickAction,
    introRightClickAction,
  ] as const;
  const actionHintIds = ["leftActionHint", "middleActionHint", "rightActionHint"] as const;

  /** The action currently chosen for `button`; "none" for unmapped buttons. */
  function selectedAction(button: number): TabWheelClickAction {
    return (actionSelects[button]?.value || "none") as TabWheelClickAction;
  }

  function selectedModifier(): TabWheelModifierKey {
    return modifierSelect.value as TabWheelModifierKey;
  }

  /** Rewrites every prompt that names the modifier combo to match the controls. */
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

  /** Updates the one-line hint under each click-action select in step 3. */
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

  /** Fills the progress bar up to and including `step`. */
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

  // Step navigation. Each transition swaps the visible flow container, shows
  // the right panel inside it, and scrolls back to the top of the page.

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

  /** Persists that the wheel demo succeeded; a no-op after the first time. */
  async function markDemoComplete(): Promise<void> {
    if (onboarding.demoCompleted) return;
    onboarding = { ...onboarding, demoCompleted: true };
    await saveTabWheelOnboardingState(onboarding);
  }

  /**
   * Returns the simulated browser to its starting state. A drag reorders the
   * simulated tab elements in the DOM, so this also restores their order.
   */
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

  /** Shows in the simulated browser what `action` would do to a real window. */
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

  /** Briefly highlights `button` on the mouse illustration. */
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

  /**
   * Whether `event` carries the modifier combo currently selected on this page.
   * Uses the content script's own check, against the unsaved selections.
   */
  function isConfiguredDemoGesture(event: MouseEvent): boolean {
    return isTabWheelModifier(
      event,
      selectedModifier(),
      gestureWithShift.checked,
    );
  }

  /**
   * Claims an event inside the demo so the browser's own behavior for that
   * button (context menu, middle-click autoscroll) does not also fire.
   */
  function suppressDemoEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  /**
   * Moves the simulated current tab one visible slot. Returns false at either
   * end of the strip, where a real drag would also stop.
   */
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

  /**
   * Press handler for pointerdown and mousedown. Claims the press whenever the
   * combo maps to an action, and starts a simulated drag session only for a
   * mouse pointerdown on "drag current tab". Other actions run on the click
   * events in clickDemoActionHandler, like the real content script.
   */
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
    // Capture keeps the drag tracking when the pointer leaves the simulator.
    try {
      clickGestureDemo.setPointerCapture(event.pointerId);
    } catch (_) {
      // The simulator still receives movement while the pointer stays over it.
    }
  }

  /**
   * Advances the simulated drag with the same step logic as the real one
   * (tabDragCore), so one slot here is one slot in the browser.
   */
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

  /** Ends the simulated drag on pointerup or pointercancel. */
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

  /**
   * Handles click, auxclick, and contextmenu in the demo: previews the mapped
   * action, or explains what to do when the combo is missing. A drag already
   * reported itself during the press, so its trailing click only adds a hint
   * when the pointer never moved far enough.
   */
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

  // Seed every control from the stored settings.
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

  // Wheel demo. Must be non-passive so preventDefault can stop the page from
  // scrolling while the combo is held.
  demo.addEventListener("wheel", (event) => {
    if (!isTabWheelModifier(event, selectedModifier(), gestureWithShift.checked)) {
      demoStatus.textContent =
        `Hold ${formatTabWheelModifierCombo(selectedModifier(), gestureWithShift.checked)} while scrolling.`;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Same measurement as the real gesture: trackpad inertia never counts, and
    // one mouse notch is one notch on every OS.
    if ((event as WheelEvent & { momentum?: boolean }).momentum === true) return;
    demoAccumulator += measureWheelInput(
      event,
      demo.clientHeight,
      demo.clientWidth,
      false,
      window.devicePixelRatio,
    ).deltaPx;
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
  // Mirror each step 3 select into its step 2 twin and back.
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

  // Step buttons. Saving happens only on the final step.
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
  // Step 2's save button only advances; step 3's button does the writing.
  byId<HTMLButtonElement>("saveChoicesBtn").addEventListener("click", () => {
    continueToWheelSettings();
  });
});
