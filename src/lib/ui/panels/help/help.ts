// TabWheel help overlay - read-only reference for wheel tab switching.

import browser from "webextension-polyfill";
import { escapeHtml } from "../../../common/utils/helpers";
import { createDebouncedCallback } from "../../../common/utils/asyncFlow";
import {
  describeTabWheelClickAction,
  formatTabWheelModifierCombo,
  loadTabWheelSettings,
  normalizeTabWheelSettings,
  TABWHEEL_STORAGE_KEYS,
} from "../../../common/contracts/tabWheel";
import { openTabWheelOptions } from "../../../adapters/runtime/tabWheelApi";
import {
  createPanelHost,
  dismissPanel,
  footerRowHtml,
  getBaseStyles,
  registerPanelCleanup,
  removePanelHost,
} from "../../../common/utils/panelHost";
import styles from "./help.css";

interface HelpSection {
  title: string;
  layout?: "rows" | "centered";
  items: { label?: string; token?: string; value: string }[];
}

const SCROLL_STEP = 80;

function buildHelpSections(settings: TabWheelSettings): HelpSection[] {
  const gestureModifier = formatTabWheelModifierCombo(settings.gestureModifier, settings.gestureWithShift);
  const leftClickAction = describeTabWheelClickAction(settings.leftClickAction);
  const middleClickAction = describeTabWheelClickAction(settings.middleClickAction);
  const rightClickAction = describeTabWheelClickAction(settings.rightClickAction);
  const editableFields = settings.allowGesturesInEditableFields
    ? "Allow wheel-cycling when cursor is inside text boxes, search fields, and editors/docs"
    : "Skip wheel-cycling when cursor is inside text boxes, search fields, and editors/docs";
  const cycleScope = settings.cycleScope === "mru" ? "MRU" : "General";
  return [
    {
      title: "How To Use",
      layout: "centered",
      items: [
        { token: `${gestureModifier} + Wheel`, value: "switches tabs using the current cycle mode" },
        { token: `${gestureModifier} + Left Click`, value: leftClickAction },
        { token: `${gestureModifier} + Middle Click`, value: middleClickAction },
        { token: `${gestureModifier} + Right Click`, value: rightClickAction },
      ],
    },
    {
      title: "Caveats",
      layout: "centered",
      items: [
        { token: "Modifier-click caveat", value: "modifier + left/middle/right click can be reserved by sites, browsers, or the OS; change modifier or require Shift if it conflicts" },
        { token: "Extension constraints", value: "page gestures work on normal web pages; browser UI, browser stores, PDFs, and internal pages can block content scripts" },
      ],
    },
    {
      title: "Shortcuts",
      items: [
        { label: "Switch tabs", value: `${gestureModifier} + Wheel` },
        { label: "Left click", value: `${gestureModifier} + Left Click ${leftClickAction}` },
        { label: "Middle click", value: `${gestureModifier} + Middle Click ${middleClickAction}` },
        { label: "Right click", value: `${gestureModifier} + Right Click ${rightClickAction}` },
        { label: "Editable fields", value: editableFields },
        { label: "Wheel down/right", value: settings.invertScroll ? "goes to previous tab" : "goes to next tab" },
        { label: "Wheel up/left", value: settings.invertScroll ? "goes to next tab" : "goes to previous tab" },
      ],
    },
    {
      title: "Cycle Modes",
      items: [
        { label: "Current mode", value: cycleScope },
        { label: "General", value: "switch through eligible tabs in visible tab order" },
        { label: "MRU", value: "switch through eligible tabs in most-recently-used order" },
        { label: "Pinned tabs", value: settings.skipPinnedTabs ? "left out of cycling" : "included in cycling" },
        { label: "Restricted pages", value: settings.skipRestrictedPages ? "left out of cycling" : "included when the browser allows activation" },
        { label: "Hidden tabs", value: settings.skipHiddenTabs ? "left out of cycling" : "included in cycling" },
        { label: "Wrap around", value: settings.wrapAround ? "last tab continues to first tab" : "stop at the first or last tab" },
      ],
    },
    {
      title: "Wheel Feel",
      items: [
        { label: "Preset", value: `${settings.wheelPreset} timing profile` },
        { label: "Sensitivity", value: `${settings.wheelSensitivity.toFixed(1)}x wheel distance before switching` },
        { label: "Cooldown", value: `${Math.round(settings.wheelCooldownMs)}ms minimum delay between switches` },
        { label: "Page scroll speed", value: `${settings.pageScrollSpeedMultiplier.toFixed(1)}x normal wheel page speed` },
        { label: "Viewport step cap", value: `${Math.round(settings.pageScrollViewportCapRatio * 100)}% maximum page-scroll step` },
        { label: "Acceleration", value: settings.wheelAcceleration ? "repeated wheel bursts switch faster" : "repeated wheel bursts keep the same delay" },
        { label: "Horizontal wheel", value: settings.horizontalWheel ? "sideways wheel or trackpad motion also switches tabs" : "only vertical wheel movement switches tabs" },
        { label: "Safe overshoot guard", value: settings.overshootGuard ? "prevents extra tab jumps from trackpad or wheel momentum" : "every qualified wheel tick can switch tabs" },
      ],
    },
  ];
}

function buildSectionsHtml(sections: HelpSection[]): string {
  return sections.map((section) => {
    const isCentered = section.layout === "centered";
    const itemsHtml = isCentered
      ? section.items.map((item) => `
          <div class="ht-help-step${item.token ? " ht-help-step-with-token" : ""}">${
            item.token
              ? `<span class="ht-help-step-token">${escapeHtml(item.token)}</span><span class="ht-help-step-action">${escapeHtml(item.value)}</span>`
              : escapeHtml(item.value)
          }</div>
        `).join("")
      : section.items.map((item) => `
          <div class="ht-help-row">
            <span class="ht-help-label">${escapeHtml(item.label || "")}</span>
            <span class="ht-help-key">${escapeHtml(item.value)}</span>
          </div>
        `).join("");

    return `
      <section class="ht-help-section${isCentered ? " ht-help-section-centered" : ""}">
        <div class="ht-help-header">${escapeHtml(section.title)}</div>
        <div class="${isCentered ? "ht-help-steps" : "ht-help-items"}">
          ${itemsHtml}
        </div>
      </section>
    `;
  }).join("");
}

export async function openTabWheelHelpOverlay(): Promise<void> {
  try {
    const settings = await loadTabWheelSettings();
    const { host, shadow } = createPanelHost();

    const style = document.createElement("style");
    style.textContent = getBaseStyles() + styles;
    shadow.appendChild(style);

    const backdrop = document.createElement("div");
    backdrop.className = "ht-backdrop";
    shadow.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "ht-help-container";
    shadow.appendChild(panel);

    panel.innerHTML = `
      <div class="ht-titlebar">
        <div class="ht-traffic-lights">
          <button class="ht-dot ht-dot-close" title="Close"></button>
        </div>
        <span class="ht-help-titlebar-text">
          <span class="ht-help-title-label">Scroll Wheel Tab Switcher Help</span>
        </span>
        <button class="ht-help-settings" data-action="settings" title="Settings" aria-label="Open settings">&#9881;</button>
      </div>
      <div class="ht-help-body">
        ${buildSectionsHtml(buildHelpSections(settings))}
      </div>
      <div class="ht-footer">
        ${footerRowHtml([
          { key: "j/k", desc: "scroll" },
          { key: "ArrowUp/ArrowDown", desc: "scroll" },
        ])}
        ${footerRowHtml([
          { key: "Wheel", desc: "scroll" },
          { key: "Esc", desc: "close" },
        ])}
      </div>
    `;

    const body = panel.querySelector(".ht-help-body") as HTMLDivElement;
    const closeButton = panel.querySelector(".ht-dot-close") as HTMLButtonElement;
    const settingsButton = panel.querySelector('[data-action="settings"]') as HTMLButtonElement;

    const debouncedRebuild = createDebouncedCallback((rawSettings: unknown) => {
      body.innerHTML = buildSectionsHtml(buildHelpSections(normalizeTabWheelSettings(rawSettings)));
    }, 150);

    function close(): void {
      document.removeEventListener("keydown", keyHandler, true);
      debouncedRebuild.cancel();
      browser.storage.onChanged.removeListener(storageChangedHandler);
      removePanelHost();
    }

    function storageChangedHandler(
      changes: Record<string, browser.Storage.StorageChange>,
    ): void {
      const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];
      if (!settingsChange) return;
      debouncedRebuild(settingsChange.newValue);
    }

    function keyHandler(event: KeyboardEvent): void {
      if (!document.getElementById("ht-panel-host")) {
        document.removeEventListener("keydown", keyHandler, true);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        event.stopPropagation();
        body.scrollTop += SCROLL_STEP;
        return;
      }

      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        body.scrollTop -= SCROLL_STEP;
        return;
      }

      event.stopPropagation();
    }

    backdrop.addEventListener("click", close);
    backdrop.addEventListener("mousedown", (event) => event.preventDefault());
    closeButton.addEventListener("click", close);
    settingsButton.addEventListener("click", async () => {
      const result = await openTabWheelOptions();
      if (!result.ok) {
        console.warn("[TabWheel] Failed to open options:", result.reason);
        return;
      }
      close();
    });
    document.addEventListener("keydown", keyHandler, true);
    browser.storage.onChanged.addListener(storageChangedHandler);
    panel.addEventListener("wheel", (event: WheelEvent) => {
      event.stopPropagation();
      if (!body.contains(event.target as Node)) {
        event.preventDefault();
      }
    }, { passive: false });
    registerPanelCleanup(close);
    host.focus();
  } catch (error) {
    console.error("[TabWheel] Failed to open help overlay:", error);
    dismissPanel();
  }
}
