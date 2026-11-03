import { useMemo, useState } from "react";
import { ConfirmDialog, type PendingAction } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";
import { showToast } from "../components/toast";
import { Badge, Banner, Card, Empty, Loading, Sparkline, Status } from "../components/ui";
import { ACTION_REGISTRY, commandPreview, clientSignature } from "../lib/actions";
import { appendActivity, loadActivity, recordFromOutcome, type ActivityRecord } from "../lib/activity";
import { errorText } from "../lib/client";
import { relTime, size } from "../lib/format";
import { seriesOf, trendOf, useMonitor, type MonitorKey } from "../lib/monitor";
import type { PageProps } from "../lib/page";
import { ENV_LABEL } from "../lib/store";
import type { ActionId, ActionOutcome } from "../lib/types";
import { useResource } from "../lib/useResource";
import { consistencyLabel, deriveWorkbench, type QuickAction, type Tone } from "../lib/workbench";

const DOT: Record<Tone, string> = {
  ok: "dot dot-up",
  warn: "dot dot-warn",
  err: "dot dot-down",
  idle: "dot dot-idle",
};

const BADGE: Record<Tone, "ok" | "warn" | "err" | "plain"> = {
  ok: "ok",
  warn: "warn",
  err: "err",
  idle: "plain",
};

const MONITOR_CELLS: {
  key: MonitorKey;
  label: string;
  unit: string;
  format: (value: number) => string;
  delta: (value: number) => string;
}[] = [
  {
    key: "cpu",
    label: "CPU 占用",
    unit: "%",
    format: (value) => value.toFixed(1),
    delta: (value) => `${Math.abs(value).toFixed(1)}%`,
  },
  {
    key: "memMb",
    label: "内存占用",
    unit: "",
    format: (value) => size(value),
    delta: (value) => `${Math.abs(value).toFixed(0)} MB`,
  },
  {
    key: "restarts",
    label: "重启次数",
    unit: "",
    format: (value) => String(Math.round(value)),
    delta: (value) => `${Math.abs(Math.round(value))} 次`,
  },
  {
    key: "firing",
    label: "触发告警",
    unit: "",
    format: (value) => String(Math.round(value)),
    delta: (value) => `${Math.abs(Math.round(value))} 条`,
  },
];

export function WorkbenchPage({ client, settings, onNavigate }: PageProps) {
  const signature = clientSignature(settings.mode, settings.agentUrl, "workbench");
  const resource = useResource(async () => {
    const [docker, git, jenkins, observability, mysql] = await Promise.all([
      client.docker(),
      client.git(),
      client.jenkins(),
      client.observability(),
      client.mysql(),
    ]);
    return { docker, git, jenkins, observability, mysql };
  }, signature);

  const [project, setProject] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionOutcome | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>(() => loadActivity());
  const monitor = useMonitor(client);

  const data = resource.data;
  const model = useMemo(() => {
    if (!data) return null;
    return deriveWorkbench({ ...data, settings, project: project || undefined });
  }, [data, settings, project]);

  if (resource.error && !data) {
    return (
      <div className="page">
        <Banner tone="error" icon="alert">
          {resource.error}
        </Banner>
      </div>
    );
  }

  if (!model || !data) {
    return (
      <div className="page">
        <Loading label="正在读取发布链…" />
      </div>
    );
  }

  const consistency = consistencyLabel(model.consistency.state);
  const selected = project || model.project?.name || "";
  const pendingTone: Tone =
    model.pending.some((item) => item.tone === "err")
      ? "err"
      : model.pending.some((item) => item.tone === "warn")
        ? "warn"
        : model.pending.length > 0
          ? "idle"
          : "ok";

  function openAction(action: QuickAction) {
    if (action.kind === "link") {
      onNavigate(action.page);
      return;
    }
    const meta = ACTION_REGISTRY[action.id];
    setResult(null);
    setPending({
      id: action.id,
      label: meta.label,
      target: action.target,
      command: commandPreview(action.id, action.target, settings.endpoints.jenkins),
      impact: meta.impact,
      danger: meta.danger,
    });
  }

  async function run(target: ActionId, actionTarget: string) {
    setBusy(true);
    try {
      const outcome = await client.execute({ action: target, target: actionTarget });
      setResult(outcome);
      setActivity(appendActivity(recordFromOutcome(outcome, ACTION_REGISTRY[target].label, actionTarget)));
      showToast(outcome.ok ? "命令执行完成" : "命令执行失败", outcome.ok ? "default" : "warn");
      resource.reload();
    } catch (error) {
      const message = errorText(error);
      const outcome: ActionOutcome = {
        action: target,
        command: commandPreview(target, actionTarget, settings.endpoints.jenkins),
        ok: false,
        simulated: false,
        output: "",
        error: message,
        durationMs: 0,
        at: new Date().toISOString(),
      };
      setResult(outcome);
      setActivity(appendActivity(recordFromOutcome(outcome, ACTION_REGISTRY[target].label, actionTarget)));
      showToast(message, "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {settings.mode === "demo" && (
        <Banner tone="info" icon="info">
          演示模式：下面的按钮会走完整的确认流程，但不会真的在本机执行任何命令。
        </Banner>
      )}

      <div className="context-bar">
        <div className="context-main">
          <span className="context-label">项目</span>
          <select className="select mono" value={selected} onChange={(event) => setProject(event.target.value)}>
            {data.docker.projects.length === 0 && <option value="">没有 compose 项目</option>}
            {data.docker.projects.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <Badge tone="plain">{ENV_LABEL[settings.env]}</Badge>
          {model.commit?.short && (
            <span className="chip mono">
              {model.repo?.branch ?? "main"}@{model.commit.short}
            </span>
          )}
          {model.links[2] && model.links[2].value !== "没有运行中的容器" && (
            <span className="chip mono">{model.links[2].value}</span>
          )}
        </div>
        <div className="context-side">
          <Status tone={pendingTone}>{model.pending.length} 项待处理</Status>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={resource.reload}
            disabled={resource.loading}
          >
            <Icon name="refresh" size={13} />
            {resource.loading ? "读取中" : "刷新"}
          </button>
        </div>
      </div>

      <div className="grid cols-2">
        <Card
          title="待处理"
          sub="按影响排序，点一行跳到对应模块"
          actions={<Badge tone={BADGE[pendingTone]}>{model.pending.length}</Badge>}
        >
          {model.pending.length === 0 ? (
            <Empty icon="check" title="没有待处理的问题" hint="版本一致、告警静默、容器健康。" />
          ) : (
            <div className="list">
              {model.pending.map((item) => (
                <div
                  key={item.id}
                  className="row-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(item.page)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onNavigate(item.page);
                    }
                  }}
                >
                  <span className={DOT[item.tone]} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title truncate">{item.title}</div>
                    <div className="list-sub truncate">{item.detail}</div>
                  </div>
                  <Icon name="chevronRight" size={14} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="发布链"
          sub="提交 → 构建 → 镜像 → 运行"
          actions={<Badge tone={BADGE[consistency.tone]}>{consistency.text}</Badge>}
        >
          <div className="chain">
            {model.links.map((link) => (
              <div className="chain-step" key={link.key}>
                <span className={`chain-dot ${link.tone}`} />
                <div className="chain-body">
                  <div className="chain-title">
                    <span className="context-label">{link.label}</span>
                    <span className="chain-value mono">{link.value}</span>
                  </div>
                  <div className="chain-meta">{link.meta}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="small dim" style={{ margin: "10px 0 0" }}>
            {model.consistency.detail}
          </p>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="下一步" sub="执行前都会弹一次确认，命令与影响写在弹窗里">
          <div className="quick-grid">
            {model.actions.map((action, index) => (
              <button
                key={`${action.kind}-${index}`}
                type="button"
                className={`quick-action${action.kind === "run" && action.danger ? " danger" : ""}`}
                onClick={() => openAction(action)}
              >
                <span className="quick-title">
                  {action.label}
                  <Icon name={action.kind === "run" ? "play" : "chevronRight"} size={12} />
                </span>
                <span className="quick-hint">{action.hint}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card
          title="运行态势"
          sub="每 10 秒采一次，最多保留 30 个点"
          actions={
            <button type="button" className="btn btn-ghost btn-sm" onClick={monitor.toggle}>
              <Icon name={monitor.paused ? "play" : "pause"} size={12} />
              {monitor.paused ? "继续" : "暂停"}
            </button>
          }
        >
          {monitor.error && <Banner tone="error" icon="alert">{monitor.error}</Banner>}
          <div className="monitor-grid">
            {MONITOR_CELLS.map((cell) => {
              const series = seriesOf(monitor.samples, cell.key);
              const trend = trendOf(monitor.samples, cell.key);
              return (
                <div className="monitor-cell" key={cell.key}>
                  <div className="monitor-head">{cell.label}</div>
                  <div className="monitor-value">
                    {series.length === 0 ? "—" : cell.format(trend.current)}
                    {cell.unit && series.length > 0 && <span className="unit">{cell.unit}</span>}
                  </div>
                  {series.length < 2 ? (
                    <div className="monitor-blank">等待更多采样</div>
                  ) : (
                    <>
                      <Sparkline points={series} height={34} />
                      <div className="monitor-foot">
                        {trend.direction === "up"
                          ? `+${cell.delta(trend.delta)}`
                          : trend.direction === "down"
                            ? `−${cell.delta(trend.delta)}`
                            : "持平"}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="最近操作" sub="只记在这台机器的浏览器里；agent 端另有一份 JSONL 审计日志">
        {activity.length === 0 ? (
          <p className="small dim" style={{ margin: 0 }}>
            还没有执行过命令。上面「下一步」里的按钮执行后会记在这里。
          </p>
        ) : (
          <div className="list">
            {activity.slice(0, 6).map((item) => (
              <div className="row-item static" key={item.id}>
                <span className={item.ok ? "dot dot-up" : "dot dot-down"} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-title truncate">
                    {item.label} · <span className="mono">{item.target}</span>
                  </div>
                  <div className="list-sub truncate">
                    <span className="mono">{item.command}</span>
                    {item.error ? ` · ${item.error}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                  {item.simulated && <Badge tone="warn">演示</Badge>}
                  <span className="small dim">{relTime(item.at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        pending={pending}
        busy={busy}
        result={result}
        onCancel={() => {
          setPending(null);
          setResult(null);
        }}
        onRun={() => {
          if (pending) void run(pending.id, pending.target);
        }}
      />
    </div>
  );
}
