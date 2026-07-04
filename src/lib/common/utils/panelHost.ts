// Shadow DOM panel host — creates an isolated overlay container with focus
// trapping so keyboard input stays inside the panel instead of the address bar.

import browser from "webextension-polyfill";
import { escapeHtml } from "./helpers";

export interface PanelHost {
  host: HTMLDivElement;
  shadow: ShadowRoot;
}

export interface PanelModalSession {
  dispose(): void;
}

export type PanelModalEventType =
  | "keydown"
  | "keypress"
  | "keyup"
  | "pointerdown"
  | "pointerup"
  | "mousedown"
  | "mouseup"
  | "click"
  | "auxclick"
  | "contextmenu";

export interface PanelModalSessionOptions {
  root: ShadowRoot;
  onClose: () => void;
  containEvents?: boolean;
  closeOnEscape?: boolean;
  closeOnFullscreenChange?: boolean;
  closeOnPageHide?: boolean;
  closeOnVisibilityHidden?: boolean;
  eventTypes?: readonly PanelModalEventType[];
}

interface FooterHintSpec {
  key: string;
  desc: string;
  active?: boolean;
}

// Active panel cleanup — called before opening a new panel so the previous
// panel's keydown listener (registered on document) is properly removed.
let activePanelCleanup: (() => void) | null = null;
let activePanelFailSafeCleanup: (() => void) | null = null;

const DEFAULT_PANEL_MODAL_EVENT_TYPES: readonly PanelModalEventType[] = [
  "keydown",
  "keypress",
  "keyup",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "auxclick",
  "contextmenu",
];

function invokeCleanupSafely(
  label: string,
  cleanup: (() => void) | null,
): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch (error) {
    console.error(`[TabWheel] ${label}:`, error);
  }
}

function cleanupPanelFailSafe(): void {
  const cleanup = activePanelFailSafeCleanup;
  activePanelFailSafeCleanup = null;
  invokeCleanupSafely("Panel fail-safe cleanup failed", cleanup);
}

function handlePanelRuntimeFault(label: string, reason: unknown): void {
  if (!document.getElementById("ht-panel-host")) return;
  console.error(`[TabWheel] ${label}; dismissing panel.`, reason);
  dismissPanel();
}

const EXTENSION_BASE_URL = browser.runtime.getURL("");

function reasonLooksExtensionScoped(reason: unknown): boolean {
  if (!reason) return false;
  if (typeof reason === "string") return reason.includes(EXTENSION_BASE_URL);
  if (typeof reason === "object") {
    const maybeError = reason as { stack?: unknown; message?: unknown };
    if (typeof maybeError.stack === "string" && maybeError.stack.includes(EXTENSION_BASE_URL)) {
      return true;
    }
    if (typeof maybeError.message === "string" && maybeError.message.includes(EXTENSION_BASE_URL)) {
      return true;
    }
  }
  return false;
}

function isPanelRuntimeFaultFromExtension(event: ErrorEvent): boolean {
  if (typeof event.filename === "string" && event.filename.startsWith(EXTENSION_BASE_URL)) {
    return true;
  }
  if (reasonLooksExtensionScoped(event.error)) return true;
  return reasonLooksExtensionScoped(event.message);
}

/** Register a cleanup function for the currently open panel.
 *  Called by each overlay after setup so createPanelHost can tear it down. */
export function registerPanelCleanup(fn: () => void): void {
  activePanelCleanup = fn;
}

/** Create a full-viewport Shadow DOM host for overlay panels.
 *  Cleans up and removes any existing panel first — only one panel at a time. */
export function createPanelHost(): PanelHost {
  // Clean up previous panel's event listeners before removing DOM
  if (activePanelCleanup) {
    const cleanup = activePanelCleanup;
    activePanelCleanup = null;
    invokeCleanupSafely("Panel cleanup failed while opening a new panel", cleanup);
  }
  cleanupPanelFailSafe();
  const existing = document.getElementById("ht-panel-host");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "ht-panel-host";
  host.tabIndex = -1;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:auto;overscroll-behavior:contain;isolation:isolate;";
  const shadow = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  let lastFocusedInPanel: HTMLElement | null = null;
  let pointerInteractionInPanel = false;
  shadow.addEventListener("focusin", (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      lastFocusedInPanel = target;
    }
  });
  shadow.addEventListener("pointerdown", () => {
    pointerInteractionInPanel = true;
  });
  const onGlobalPointerEnd = (): void => {
    pointerInteractionInPanel = false;
  };
  window.addEventListener("pointerup", onGlobalPointerEnd, true);
  window.addEventListener("pointercancel", onGlobalPointerEnd, true);

  const focusPreferredPanelTarget = (): void => {
    if (!document.getElementById("ht-panel-host")) return;
    if (lastFocusedInPanel && shadow.contains(lastFocusedInPanel)) {
      lastFocusedInPanel.focus({ preventScroll: true });
      return;
    }
    host.focus({ preventScroll: true });
  };

  // Reclaim focus when it escapes the panel (e.g. to the browser UI).
  // Must check both host.contains() and shadowRoot.contains() because
  // Shadow DOM children aren't found by host.contains().
  let reclaimId = 0;
  host.addEventListener("focusout", () => {
    cancelAnimationFrame(reclaimId);
    reclaimId = requestAnimationFrame(() => {
      if (document.visibilityState !== "visible") return;
      if (pointerInteractionInPanel) return;
      if (!document.getElementById("ht-panel-host")) return;

      const activeInHostTree = document.activeElement === host || host.contains(document.activeElement);
      const activeInShadow = !!shadow.activeElement && shadow.contains(shadow.activeElement as Node);
      if (!activeInHostTree && !activeInShadow) {
        focusPreferredPanelTarget();
      }
    });
  });

  const onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    if (!document.getElementById("ht-panel-host")) return;
    const activeInHostTree = document.activeElement === host || host.contains(document.activeElement);
    const activeInShadow = !!shadow.activeElement && shadow.contains(shadow.activeElement as Node);
    if (!activeInHostTree && !activeInShadow) {
      focusPreferredPanelTarget();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const onError = (event: ErrorEvent): void => {
    if (!isPanelRuntimeFaultFromExtension(event)) return;
    handlePanelRuntimeFault("Panel runtime error", event.error || event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (!reasonLooksExtensionScoped(event.reason)) return;
    handlePanelRuntimeFault("Panel unhandled rejection", event.reason);
  };

  // Watchdog: the host covers the whole viewport at maximum z-index, so a
  // stuck overlay makes the page unusable. If no animation frame has run for
  // 3s while the panel is visible, assume the panel is stuck and remove it.
  let lastAnimationFrameAt = performance.now();
  let frameProbeId = 0;
  const frameProbe = (ts: number): void => {
    lastAnimationFrameAt = ts;
    frameProbeId = requestAnimationFrame(frameProbe);
  };
  frameProbeId = requestAnimationFrame(frameProbe);
  const watchdogIntervalId = window.setInterval(() => {
    if (!document.getElementById("ht-panel-host")) return;
    if (document.visibilityState !== "visible") return;
    const gapMs = performance.now() - lastAnimationFrameAt;
    if (gapMs > 3000) {
      handlePanelRuntimeFault("Panel watchdog detected UI stall", { gapMs });
    }
  }, 1000);

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  activePanelFailSafeCleanup = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.removeEventListener("pointerup", onGlobalPointerEnd, true);
    window.removeEventListener("pointercancel", onGlobalPointerEnd, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    cancelAnimationFrame(frameProbeId);
    window.clearInterval(watchdogIntervalId);
  };

  return { host, shadow };
}

export function removePanelHost(): void {
  cleanupPanelFailSafe();
  const host = document.getElementById("ht-panel-host");
  if (host) host.remove();
  activePanelCleanup = null;
}

export function createPanelModalSession(options: PanelModalSessionOptions): PanelModalSession {
  const root = options.root;
  const host = root.host;
  const eventTypes = options.eventTypes ?? DEFAULT_PANEL_MODAL_EVENT_TYPES;
  const containEvents = options.containEvents !== false;
  const closeOnEscape = options.closeOnEscape !== false;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const eventType of eventTypes) {
      root.removeEventListener(eventType, modalEventHandler);
    }
    document.removeEventListener("keydown", documentKeyHandler, true);
    document.removeEventListener("fullscreenchange", fullscreenChangeHandler, true);
    document.removeEventListener("visibilitychange", visibilityChangeHandler, true);
    window.removeEventListener("pagehide", pageHideHandler, true);
  };

  const requestClose = (): void => {
    if (disposed) return;
    dispose();
    options.onClose();
  };

  function isPanelEvent(event: Event): boolean {
    const path = event.composedPath();
    return path.includes(root) || path.includes(host);
  }

  function modalEventHandler(event: Event): void {
    if (containEvents) event.stopPropagation();
    if (closeOnEscape && event instanceof KeyboardEvent && event.key === "Escape") {
      event.preventDefault();
      requestClose();
    }
  }

  function documentKeyHandler(event: KeyboardEvent): void {
    if (!closeOnEscape || event.key !== "Escape" || !isPanelEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestClose();
  }

  function fullscreenChangeHandler(): void {
    if (options.closeOnFullscreenChange !== true) return;
    requestClose();
  }

  function pageHideHandler(): void {
    if (options.closeOnPageHide !== true) return;
    requestClose();
  }

  function visibilityChangeHandler(): void {
    if (options.closeOnVisibilityHidden !== true) return;
    if (document.visibilityState !== "hidden") return;
    requestClose();
  }

  for (const eventType of eventTypes) {
    root.addEventListener(eventType, modalEventHandler);
  }
  document.addEventListener("keydown", documentKeyHandler, true);
  document.addEventListener("fullscreenchange", fullscreenChangeHandler, true);
  document.addEventListener("visibilitychange", visibilityChangeHandler, true);
  window.addEventListener("pagehide", pageHideHandler, true);

  return { dispose };
}

/** Fully dismiss the active panel — cleanup listeners + remove DOM. */
export function dismissPanel(): void {
  const cleanup = activePanelCleanup;
  activePanelCleanup = null;
  invokeCleanupSafely("Panel cleanup failed during dismiss", cleanup);
  removePanelHost();
}

function footerHintHtml(hint: FooterHintSpec): string {
  const activeClass = hint.active ? " ht-footer-hint-active" : "";
  return `<span class="ht-footer-hint${activeClass}">
    <strong class="ht-footer-key">${escapeHtml(hint.key)}</strong>
    <span class="ht-footer-desc">${escapeHtml(hint.desc)}</span>
  </span>`;
}

export function footerRowHtml(hints: FooterHintSpec[]): string {
  if (hints.length === 0) return `<div class="ht-footer-row"></div>`;
  const pieces: string[] = [];
  for (let i = 0; i < hints.length; i++) {
    if (i > 0) {
      pieces.push(`<span class="ht-footer-sep" aria-hidden="true">|</span>`);
    }
    pieces.push(footerHintHtml(hints[i]));
  }
  return `<div class="ht-footer-row">${pieces.join("")}</div>`;
}

/** Shared overlay shell styles used by all panels */
export function getBaseStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :host {
      all: initial;
      --ht-font-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      --ht-color-bg: #1e1e1e;
      --ht-color-bg-elevated: #252525;
      --ht-color-bg-soft: #3a3a3c;
      --ht-color-bg-detail-focus: #1a2230;
      --ht-color-bg-detail-focus-header: #1e2a3a;
      --ht-color-bg-code: #1a1a1a;
      --ht-color-text: #e0e0e0;
      --ht-color-text-soft: #c0c0c0;
      --ht-color-text-muted: #808080;
      --ht-color-text-title: #a0a0a0;
      --ht-color-text-detail-focus: #a0c0e0;
      --ht-color-text-dim: #666;
      --ht-color-text-faint: #555;
      --ht-color-text-strong: #fff;
      --ht-color-accent: #0a84ff;
      --ht-color-accent-soft: rgba(10,132,255,0.1);
      --ht-color-accent-active: rgba(10,132,255,0.15);
      --ht-color-accent-soft-strong: rgba(10,132,255,0.12);
      --ht-color-accent-soft-faint: rgba(10,132,255,0.08);
      --ht-color-accent-alt: #af82ff;
      --ht-color-accent-alt-soft: rgba(175,130,255,0.15);
      --ht-color-success: #32d74b;
      --ht-color-tree-cursor: #4ec970;
      --ht-color-tree-cursor-bg: rgba(78,201,112,0.15);
      --ht-color-tree-cursor-bg-soft: rgba(78,201,112,0.18);
      --ht-color-tree-cursor-bg-strong: rgba(78,201,112,0.20);
      --ht-color-danger: #ff5f57;
      --ht-color-warning: #febc2e;
      --ht-color-mark-bg: #f9d45c;
      --ht-color-mark-fg: #1e1e1e;
      --ht-color-border: rgba(255,255,255,0.1);
      --ht-color-border-soft: rgba(255,255,255,0.06);
      --ht-color-border-faint: rgba(255,255,255,0.04);
      --ht-color-border-ultra-faint: rgba(255,255,255,0.03);
      --ht-color-hover: rgba(255,255,255,0.06);
      --ht-color-focus-active: rgba(255,255,255,0.13);
      --ht-color-surface: rgba(255,255,255,0.08);
      --ht-color-surface-dim: rgba(255,255,255,0.04);
      --ht-color-surface-strong: rgba(255,255,255,0.15);
      --ht-shadow-overlay: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
      --ht-radius: 10px;
      --ht-input-row-pad-y: 8px;
      --ht-input-row-pad-x: 14px;
      --ht-input-row-pad-x-compact: 10px;
      --ht-input-prompt-gap: 8px;
      --ht-input-prompt-size: 14px;
      --ht-input-prompt-weight: 600;
      --ht-input-font-size: 13px;
      --ht-input-caret-color: var(--ht-color-text-strong);
      --ht-pane-header-pad-y: 5px;
      --ht-pane-header-pad-x: 14px;
      --ht-pane-header-font-size: 11px;
      --ht-pane-header-weight: 500;
      font-family: var(--ht-font-mono);
      font-size: 13px;
      color: var(--ht-color-text);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .ht-backdrop {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      width: 100dvw; height: 100dvh;
      background: rgba(0, 0, 0, 0.55);
    }

    /* Keep every overlay shell truly centered, even if panel-specific
       rules regress or are partially overridden. */
    .ht-help-container {
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      margin: 0 !important;
    }

    .ht-titlebar {
      display: flex; align-items: center;
      padding: 10px 14px;
      background: var(--ht-color-bg-soft);
      border-bottom: 1px solid var(--ht-color-border-soft);
      border-radius: var(--ht-radius) var(--ht-radius) 0 0;
      user-select: none;
    }
    .ht-traffic-lights {
      display: flex; gap: 7px; margin-right: 14px; flex-shrink: 0;
    }
    .ht-dot {
      width: 12px; height: 12px; border-radius: 50%;
      cursor: pointer; border: none;
      transition: filter 0.15s;
    }
    .ht-dot:hover { filter: brightness(1.2); }
    .ht-dot-close { background: var(--ht-color-danger); }
    .ht-titlebar-text {
      flex: 1; text-align: center; font-size: 12px;
      color: var(--ht-color-text-title); font-weight: 500;
    }

    /* Reusable UI primitives (input rows + pane headers) for panel consistency */
    .ht-ui-input-wrap {
      display: flex;
      align-items: center;
      padding: var(--ht-input-row-pad-y) var(--ht-input-row-pad-x);
      border-bottom: 1px solid var(--ht-color-border-soft);
      background: var(--ht-color-bg-elevated);
    }
    .ht-ui-input-prompt {
      color: var(--ht-color-accent);
      margin-right: var(--ht-input-prompt-gap);
      font-weight: var(--ht-input-prompt-weight);
      font-size: var(--ht-input-prompt-size);
    }
    .ht-ui-input-field {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--ht-color-text);
      font-family: inherit;
      font-size: var(--ht-input-font-size);
      caret-color: var(--ht-input-caret-color);
    }
    input,
    textarea {
      user-select: text;
      -webkit-user-select: text;
    }
    .ht-ui-input-field::placeholder {
      color: var(--ht-color-text-dim);
    }
    .ht-ui-pane-header {
      padding: var(--ht-pane-header-pad-y) var(--ht-pane-header-pad-x);
      font-size: var(--ht-pane-header-font-size);
      color: var(--ht-color-text-muted);
      background: var(--ht-color-bg-elevated);
      border-bottom: 1px solid var(--ht-color-border-faint);
      font-weight: var(--ht-pane-header-weight);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ht-ui-pane-header-text {
      flex: 1;
    }
    .ht-ui-pane-header-meta {
      font-size: 10px;
      color: var(--ht-color-text-dim);
      flex-shrink: 0;
    }

    .ht-vim-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
      padding: 2px 6px; border-radius: 4px;
      text-transform: uppercase; flex-shrink: 0;
      line-height: 1; margin-left: 8px;
    }
    .ht-vim-badge.on {
      background: var(--ht-color-success); color: #1a1a1a;
    }
    .ht-vim-badge.off {
      background: var(--ht-color-surface); color: var(--ht-color-text-dim);
    }

    .ht-footer {
      display: flex; gap: 16px; padding: 8px 14px;
      background: var(--ht-color-bg-elevated); border-top: 1px solid var(--ht-color-border-soft);
      font-size: 11px; color: var(--ht-color-text-muted); flex-wrap: wrap;
      border-radius: 0 0 var(--ht-radius) var(--ht-radius); justify-content: center;
    }
    .ht-footer-row {
      display: flex; gap: 8px; justify-content: center; width: 100%; flex-wrap: wrap;
      align-items: center;
    }
    .ht-footer-hint {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      white-space: nowrap;
      color: var(--ht-color-text-muted);
    }
    .ht-footer-key {
      color: var(--ht-color-text-soft);
      font-weight: 700;
    }
    .ht-footer-sep {
      color: var(--ht-color-text-dim);
      font-weight: 600;
    }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }

    @media (max-width: 520px), (max-height: 560px) {
      .ht-ui-input-wrap {
        padding: var(--ht-input-row-pad-y) var(--ht-input-row-pad-x-compact);
      }
    }
  `;
}
