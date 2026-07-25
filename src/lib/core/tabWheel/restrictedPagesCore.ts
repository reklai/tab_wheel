// Restricted-page checks are pure URL math shared by the background domain
// (gesture eligibility, content-script injection) and the toolbar badge
// decision. Keep this browser-free so both call sites stay testable.

export function normalizePageUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch (_) {
    return null;
  }
}

const KNOWN_BROWSER_STORE_RESTRICTED_HOSTS = new Set([
  "addons.mozilla.org",
  "chromewebstore.google.com",
]);

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isKnownBrowserStoreRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = normalizeHostname(parsed.hostname);
    if (KNOWN_BROWSER_STORE_RESTRICTED_HOSTS.has(hostname)) return true;
    return hostname === "chrome.google.com" && parsed.pathname.toLowerCase().startsWith("/webstore");
  } catch (_) {
    return false;
  }
}

export function isPageGestureRestrictedUrl(url: string | undefined): boolean {
  return !normalizePageUrl(url) || isKnownBrowserStoreRestrictedUrl(url);
}

// The badge wiring (reading the setting, calling browserAction.setBadgeText)
// is a later task. This is only the pure decision: show "!" when the page is
// gesture-restricted and the user has opted into the badge.
export function resolveToolbarBadge(
  pageUrl: string | undefined,
  showBadge: boolean,
): { text: string } | null {
  if (!showBadge) return null;
  return isPageGestureRestrictedUrl(pageUrl) ? { text: "!" } : null;
}
