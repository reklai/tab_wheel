// Timing and motion for TabWheel's one notice, shown on three surfaces: the
// in-page notice, the popup toast, and the settings status bar. Their visual
// tokens are pinned together by test/notice-pill.test.mjs.

// Display time, in ms: a base plus reading time per character, capped.
const NOTICE_MIN_MS = 1200;
const NOTICE_MS_PER_CHARACTER = 30;
const NOTICE_MAX_MS = 4000;

/** Rise-in transition, in ms. The popup and settings CSS use the same 180ms. */
export const NOTICE_ENTER_MS = 180;
/** Fade-out transition of the in-page notice, in ms. */
export const NOTICE_EXIT_MS = 140;

/**
 * How long, in ms, to show `message`: long enough to read it, from well under
 * two seconds for a short phrase to at most four for a long sentence.
 */
export function noticeDisplayMs(message: string): number {
  return Math.min(NOTICE_MAX_MS, NOTICE_MIN_MS + message.length * NOTICE_MS_PER_CHARACTER);
}

/** True when the user asked the OS for reduced motion; false outside a page. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
}
