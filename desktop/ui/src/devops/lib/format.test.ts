import { describe, expect, it } from "vitest";
import { absTime, clockTime, compact, dateTime, fixed, milliseconds, num, percent, relTime, seconds, size, toneForPercent } from "./format";

const MINUTE = 60_000;

describe("数字与容量", () => {
  it("num 用中文千分位，非法值回落破折号", () => {
    expect(num(1234.6)).toBe("1,235");
    expect(num(0)).toBe("0");
    expect(num(Number.NaN)).toBe("—");
  });

  it("compact 在千、百万处换单位", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1500)).toBe("1.5k");
    expect(compact(2_400_000)).toBe("2.4M");
  });

  it("size 以 MB 为输入逐级换单位", () => {
    expect(size(0.5)).toBe("512 KB");
    expect(size(512)).toBe("512 MB");
    expect(size(1536)).toBe("1.5 GB");
    expect(size(2048)).toBe("2.0 GB");
    expect(size(Number.NaN)).toBe("—");
  });
});

describe("时间格式", () => {
  it("seconds 覆盖毫秒、秒、分、时", () => {
    expect(seconds(0.25)).toBe("250 ms");
    expect(seconds(5)).toBe("5.0 s");
    expect(seconds(75)).toBe("1m 15s");
    expect(seconds(120)).toBe("2m");
    expect(seconds(3720)).toBe("1h 2m");
  });

  it("milliseconds 超过一秒后交给 seconds", () => {
    expect(milliseconds(320)).toBe("320 ms");
    expect(milliseconds(2500)).toBe("2.5 s");
  });

  it("relTime 按分钟、小时、天分档", () => {
    const now = Date.now();
    expect(relTime(new Date(now - 10_000).toISOString(), now)).toBe("刚刚");
    expect(relTime(new Date(now - 3 * MINUTE).toISOString(), now)).toBe("3 分钟前");
    expect(relTime(new Date(now - 5 * 60 * MINUTE).toISOString(), now)).toBe("5 小时前");
    expect(relTime(new Date(now - 4 * 24 * 60 * MINUTE).toISOString(), now)).toBe("4 天前");
    expect(relTime("不是时间")).toBe("—");
  });

  it("绝对时间对非法输入安全", () => {
    expect(absTime("2026-11-01T09:05:00+08:00")).toBe("11-01 09:05");
    expect(dateTime("2026-11-01T09:05:07+08:00")).toBe("2026-11-01 09:05:07");
    expect(absTime("nope")).toBe("—");
    expect(clockTime(new Date(2026, 10, 1, 9, 5, 7))).toBe("09:05:07");
  });
});

describe("比例与色调", () => {
  it("percent 夹在 0–100", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(300, 100)).toBe(100);
    expect(percent(-5, 100)).toBe(0);
    expect(percent(1, 0)).toBe(0);
  });

  it("fixed 默认一位小数", () => {
    expect(fixed(1.234)).toBe("1.2");
    expect(fixed(1.235, 2)).toBe("1.24");
  });

  it("toneForPercent 的阈值是左闭右开", () => {
    expect(toneForPercent(74.9)).toBe("good");
    expect(toneForPercent(75)).toBe("high");
    expect(toneForPercent(90)).toBe("critical");
    expect(toneForPercent(80, 100, 120)).toBe("good");
  });
});
