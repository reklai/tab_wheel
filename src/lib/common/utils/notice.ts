// One notice, three surfaces. The page notice, the popup toast, and the
// settings status share this timing and motion; their visual tokens are
// pinned together by test/notice-pill.test.mjs.

const NOTICE_MIN_MS = 1200;
const NOTICE_MS_PER_CHARACTER = 30;
const NOTICE_MAX_MS = 4000;

export const NOTICE_ENTER_MS = 180;
export const NOTICE_EXIT_MS = 140;

// A notice stays long enough to be read: a short phrase for well under two
// seconds, the longest sentence for a little over three.
export function noticeDisplayMs(message: string): number {
  return Math.min(NOTICE_MAX_MS, NOTICE_MIN_MS + message.length * NOTICE_MS_PER_CHARACTER);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
}
