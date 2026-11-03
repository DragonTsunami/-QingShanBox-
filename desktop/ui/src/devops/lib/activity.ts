import type { ActionId, ActionOutcome } from "./types";

const STORAGE_KEY = "qingshan.devops.activity";
const LIMIT = 20;

/** 本机浏览器里留一份「我执行过什么」，agent 自己还会写一份 JSONL 审计日志。 */
export interface ActivityRecord {
  id: string;
  action: ActionId;
  label: string;
  target: string;
  command: string;
  ok: boolean;
  simulated: boolean;
  at: string;
  durationMs: number;
  error: string;
}

function newId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `act-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadActivity(): ActivityRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ActivityRecord => {
      if (!isRecord(item)) return false;
      return (
        typeof item.id === "string" &&
        typeof item.action === "string" &&
        typeof item.command === "string" &&
        typeof item.at === "string" &&
        typeof item.ok === "boolean"
      );
    });
  } catch {
    return [];
  }
}

export function appendActivity(record: ActivityRecord): ActivityRecord[] {
  const next = [record, ...loadActivity()].slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式写不进去时，只保留在当前会话的内存里 */
  }
  return next;
}

export function recordFromOutcome(outcome: ActionOutcome, label: string, target: string): ActivityRecord {
  return {
    id: newId(),
    action: outcome.action,
    label,
    target,
    command: outcome.command,
    ok: outcome.ok,
    simulated: outcome.simulated,
    at: outcome.at,
    durationMs: outcome.durationMs,
    error: outcome.error,
  };
}
