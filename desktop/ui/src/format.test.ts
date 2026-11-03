import { describe, expect, it } from "vitest";
import { formatBytes, formatTimestamp, formatUptime, ratio } from "./format";

describe("formatBytes", () => {
  it("handles zero and units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1024 ** 4 * 2.5)).toBe("2.5 TB");
  });
});

describe("formatUptime", () => {
  it("formats minutes, hours and days", () => {
    expect(formatUptime(0)).toBe("未知");
    expect(formatUptime(60)).toBe("1 分钟");
    expect(formatUptime(3_661)).toBe("1 小时 1 分");
    expect(formatUptime(90_061)).toBe("1 天 1 小时");
  });
});

describe("ratio", () => {
  it("clamps to 0..100 and tolerates zero totals", () => {
    expect(ratio(50, 100)).toBe(50);
    expect(ratio(150, 100)).toBe(100);
    expect(ratio(-10, 100)).toBe(0);
    expect(ratio(1, 0)).toBe(0);
  });
});

describe("formatTimestamp", () => {
  it("renders an em dash for missing timestamps", () => {
    expect(formatTimestamp(0)).toBe("—");
  });
});
