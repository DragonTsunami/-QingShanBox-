const NUMBER_FMT = new Intl.NumberFormat("zh-CN");

export function num(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return NUMBER_FMT.format(Math.round(value));
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** 以 MB 为输入，输出 512 MB / 1.2 GB / 3.4 TB。 */
export function size(mb: number): string {
  if (!Number.isFinite(mb)) return "—";
  if (mb < 1) return `${Math.round(mb * 1024)} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  if (mb < 1024 * 1024) return `${(mb / 1024).toFixed(mb < 10 * 1024 ? 1 : 0)} GB`;
  return `${(mb / 1024 / 1024).toFixed(1)} TB`;
}

export function seconds(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)} s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function milliseconds(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return seconds(ms / 1000);
}

export function percent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function fixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 4 天前。 */
export function relTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return `${Math.floor(diff / (30 * 24 * 60 * minute))} 个月前`;
}

/** 绝对时间：11-01 17:12。 */
export function absTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function dateTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

export function clockTime(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function toneForPercent(value: number, warn = 75, danger = 90): "good" | "high" | "critical" {
  if (value >= danger) return "critical";
  if (value >= warn) return "high";
  return "good";
}
