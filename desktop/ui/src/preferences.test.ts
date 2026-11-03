import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_INTERVAL,
  REFRESH_INTERVALS,
  normalizeRefreshInterval,
} from "./preferences";

describe("refresh interval preferences", () => {
  it("exposes the required choices", () => {
    expect([...REFRESH_INTERVALS]).toEqual([60, 180, 300, 600]);
  });

  it("accepts every supported value", () => {
    for (const seconds of REFRESH_INTERVALS) {
      expect(normalizeRefreshInterval(seconds)).toBe(seconds);
      expect(normalizeRefreshInterval(String(seconds))).toBe(seconds);
    }
  });

  it("falls back to 3 minutes for unsupported values", () => {
    expect(normalizeRefreshInterval(2)).toBe(DEFAULT_REFRESH_INTERVAL);
    expect(normalizeRefreshInterval(0)).toBe(DEFAULT_REFRESH_INTERVAL);
    expect(normalizeRefreshInterval(-1)).toBe(DEFAULT_REFRESH_INTERVAL);
    expect(normalizeRefreshInterval("60s")).toBe(DEFAULT_REFRESH_INTERVAL);
    expect(normalizeRefreshInterval(null)).toBe(DEFAULT_REFRESH_INTERVAL);
    expect(normalizeRefreshInterval(undefined)).toBe(DEFAULT_REFRESH_INTERVAL);
  });
});
