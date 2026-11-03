/**
 * User-selectable auto-refresh interval. The values are seconds and are
 * persisted per browser/profile; 3 minutes remains the default.
 */
export const REFRESH_INTERVALS = [60, 180, 300, 600] as const;

export type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

export const DEFAULT_REFRESH_INTERVAL: RefreshInterval = 180;

const STORAGE_KEY = "qingshan.refreshInterval";

export function normalizeRefreshInterval(value: unknown): RefreshInterval {
  const seconds = typeof value === "string" ? Number(value) : value;
  return REFRESH_INTERVALS.includes(seconds as RefreshInterval)
    ? (seconds as RefreshInterval)
    : DEFAULT_REFRESH_INTERVAL;
}

export function loadRefreshInterval(): RefreshInterval {
  if (typeof window === "undefined") return DEFAULT_REFRESH_INTERVAL;
  try {
    return normalizeRefreshInterval(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_REFRESH_INTERVAL;
  }
}

export function saveRefreshInterval(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(normalizeRefreshInterval(value)));
  } catch {
    // Storage can be unavailable in hardened/private contexts; the in-memory
    // selection still works for the current session.
  }
}
