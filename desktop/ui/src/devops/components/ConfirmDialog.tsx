import { Alert, Button, Modal, Tag } from "antd";
import type { ActionId, ActionOutcome } from "../lib/types";

/**
 * 连接配置的删除确认。只删本地保存的连接，不触碰远程服务。
 */
export function DeleteConnectionDialog({
  open,
  name,
  kind,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
  kind: "Docker" | "MySQL";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="jenkins-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="jenkins-modal"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 440 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="jenkins-modal-head">
          <div>
            <h2>删除连接</h2>
            <p>只删除保存在本机的连接配置，不会停止远程服务，也不会删除容器或数据。</p>
          </div>
          <button type="button" className="btn btn-icon btn-sm" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="small" style={{ margin: "10px 0 18px" }}>
          确定删除 <strong>{kind} / {name}</strong> 吗？
        </p>
        <div className="jenkins-modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            删除连接
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const footer = result ? (
    <Button type="primary" onClick={onCancel}>
      关闭
    </Button>
  ) : (
    <>
      <Button onClick={onCancel} disabled={busy}>
        取消
      </Button>
      <Button type="primary" danger={pending?.danger} loading={busy} onClick={onRun}>
        {busy ? "执行中…" : "执行"}
      </Button>
    </>
  );

  return (
    <Modal
      open={Boolean(pending)}
      onCancel={() => (busy ? undefined : onCancel())}
      maskClosable={!busy}
      closable={!busy}
      destroyOnClose
      width={620}
      title={pending ? (result ? (result.ok ? "执行完成" : "执行失败") : `确认${pending.label}`) : ""}
      footer={footer}
    >
      {pending && (
        <div className="wb-dialog">
          <div className="wb-dialog-sub mono">
            {pending.target}
            {result ? ` · ${result.durationMs} ms` : " · 尚未执行"}
          </div>

          {!result && (
            <>
              <Alert
                type={pending.danger ? "error" : "warning"}
                showIcon
                message={pending.impact}
                className="wb-dialog-note"
              />
              <div>
                <div className="wb-field-label">将要执行的命令</div>
                <div className="wb-code-block">{pending.command}</div>
              </div>
              <p className="small dim" style={{ margin: 0 }}>
                命令由本机执行通道按白名单下发（不接受自由命令行）；每次执行都会写一条审计记录。
              </p>
            </>
          )}

          {result && (
            <>
              <div className="wb-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Tag bordered={false} color={result.ok ? "green" : "red"}>
                  {result.ok ? "成功" : "失败"}
                </Tag>
                {result.simulated && (
                  <Tag bordered={false} color="orange">
                    演示 · 未真的执行
                  </Tag>
                )}
                <span className="small dim mono">{result.command}</span>
              </div>
              {result.output.trim() && (
                <div>
                  <div className="wb-field-label">输出</div>
                  <pre className="wb-output-pre">{result.output.trim()}</pre>
                </div>
              )}
              {result.error.trim() && (
                <div>
                  <div className="wb-field-label">错误</div>
                  <pre className="wb-output-pre error">{result.error.trim()}</pre>
                </div>
              )}
              {!result.output.trim() && !result.error.trim() && <p className="small dim">命令没有产生输出。</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
