import { useEffect } from "react";
import { Icon } from "./Icons";
import type { ActionId, ActionOutcome } from "../lib/types";

export interface PendingAction {
  id: ActionId;
  label: string;
  target: string;
  command: string;
  impact: string;
  danger: boolean;
}

/**
 * 一次命令一次确认：弹窗里写清楚要执行什么、会影响什么，
 * 执行完把 stdout/stderr 留在同一个弹窗里，不把结果藏进 toast。
 */
export function ConfirmDialog({
  pending,
  busy,
  result,
  onCancel,
  onRun,
}: {
  pending: PendingAction | null;
  busy: boolean;
  result: ActionOutcome | null;
  onCancel: () => void;
  onRun: () => void;
}) {
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy, onCancel]);

  if (!pending) return null;

  return (
    <>
      <div className="dialog-overlay" onClick={() => (busy ? undefined : onCancel())} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`确认${pending.label}`}>
        <header className="dialog-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="card-title">
              {result ? (result.ok ? "执行完成" : "执行失败") : `确认${pending.label}`}
            </div>
            <div className="card-sub mono">
              {pending.target} · {result ? `${result.durationMs} ms` : "尚未执行"}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onCancel} aria-label="关闭" disabled={busy}>
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="dialog-body">
          {!result && (
            <>
              <div className={`dialog-note${pending.danger ? " danger" : ""}`}>
                <Icon name={pending.danger ? "alert" : "info"} size={14} />
                <span>{pending.impact}</span>
              </div>
              <div>
                <div className="field-label">将要执行的命令</div>
                <div className="code-block">{pending.command}</div>
              </div>
              <p className="small dim" style={{ margin: 0 }}>
                命令由本机 agent 按白名单执行（不接受自由命令行）；每次执行都会写一条审计记录到本机 JSONL 文件。
              </p>
            </>
          )}

          {result && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className={result.ok ? "badge tone-ok" : "badge tone-err"}>{result.ok ? "成功" : "失败"}</span>
                {result.simulated && <span className="badge tone-warn">演示 · 未真的执行</span>}
                <span className="small dim mono">{result.command}</span>
              </div>
              {result.output.trim() && (
                <div>
                  <div className="field-label">输出</div>
                  <pre className="output-pre">{result.output.trim()}</pre>
                </div>
              )}
              {result.error.trim() && (
                <div>
                  <div className="field-label">错误</div>
                  <pre className="output-pre error">{result.error.trim()}</pre>
                </div>
              )}
              {!result.output.trim() && !result.error.trim() && <p className="small dim">命令没有产生输出。</p>}
            </>
          )}
        </div>

        <footer className="dialog-foot">
          {result ? (
            <button type="button" className="btn btn-primary" onClick={onCancel}>
              关闭
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={pending.danger ? "btn btn-danger" : "btn btn-primary"}
                onClick={onRun}
                disabled={busy}
              >
                {busy ? "执行中…" : "执行"}
              </button>
            </>
          )}
        </footer>
      </div>
    </>
  );
}
