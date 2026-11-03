import { useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Empty, Loading, Sparkline, Stat, Status, type StatusTone } from "../components/ui";
import { showToast } from "../components/toast";
import { clientSignature } from "../lib/actions";
import { fixed, relTime, milliseconds, num } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { AlertRule, DevopsClient, Settings } from "../lib/types";

const SEVERITY_TONE: Record<AlertRule["severity"], "err" | "warn" | "info"> = { critical: "err", warning: "warn", info: "info" };
const SEVERITY_LABEL: Record<AlertRule["severity"], string> = { critical: "严重", warning: "警告", info: "提示" };
const ALERT_TONE: Record<AlertRule["state"], StatusTone> = { firing: "err", pending: "warn", inactive: "idle" };
const ALERT_LABEL: Record<AlertRule["state"], string> = { firing: "触发中", pending: "等待中", inactive: "已恢复" };

export function ObservabilityPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(
    () => client.observability(),
    clientSignature(settings.mode, settings.agentUrl, "observability"),
  );
  const [filter, setFilter] = useState<"all" | "firing">("all");

  const data = resource.data;
  const targets = data?.targets ?? [];
  const alerts = data?.alerts ?? [];
  const down = targets.filter((item) => item.health === "down");
  const firing = alerts.filter((item) => item.state === "firing");
  const visibleAlerts = filter === "firing" ? firing : alerts;

  if (resource.loading && !data) return <Loading label="正在读取 Prometheus 与 Grafana…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到可观测性数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      {data?.note && <Banner tone="warn">{data.note}</Banner>}
      {down.length > 0 && (
        <Banner tone="error">
          <strong>{down.map((item) => item.instance).join("、")}</strong> 抓取失败，最后一次成功在 {relTime(down[0].lastScrape)}。检查 target 是否在线、以及 Prometheus 的 <span className="mono">scrape_configs</span>。
        </Banner>
      )}

      <div className="grid cols-4">
        <Stat icon="activity" label="抓取目标" value={`${targets.length - down.length}/${targets.length}`} foot={<span>间隔 {data?.scrapeIntervalSec ?? 15}s</span>} />
        <Stat icon="alert" label="触发中告警" value={String(firing.length)} foot={<span>共 {alerts.length} 条规则</span>} />
        <Stat icon="dashboard" label="仪表盘" value={String(data?.dashboards.length ?? 0)} foot={<span>Grafana 文件夹 4 个</span>} />
        <Stat icon="clock" label="时序" value={String(data?.series.length ?? 0)} foot={<span>最近 12 分钟采样</span>} />
      </div>

      <Card
        flush
        title="告警"
        sub="Prometheus 规则评估结果"
        actions={
          <div className="segmented" role="group">
            <button type="button" className={filter === "all" ? "active" : undefined} onClick={() => setFilter("all")}>
              全部 {alerts.length}
            </button>
            <button type="button" className={filter === "firing" ? "active" : undefined} onClick={() => setFilter("firing")}>
              触发中 {firing.length}
            </button>
          </div>
        }
      >
        <DataTable
          rows={visibleAlerts}
          rowKey={(row) => row.name}
          columns={[
            { key: "severity", header: "级别", width: 70, render: (row) => <Badge tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Badge> },
            {
              key: "name",
              header: "规则",
              render: (row) => (
                <div className="stack" style={{ gap: 2 }}>
                  <span className="strong mono">{row.name}</span>
                  <span className="small dim">{row.summary}</span>
                </div>
              ),
            },
            { key: "state", header: "状态", render: (row) => <Status tone={ALERT_TONE[row.state]}>{ALERT_LABEL[row.state]}</Status> },
            { key: "value", header: "当前值", align: "right", render: (row) => <span className="mono small">{row.value ?? "—"}</span> },
            { key: "since", header: "持续", render: (row) => <span className="small dim">{row.since ? relTime(row.since) : "—"}</span> },
          ]}
          empty={<Empty icon="check" title={filter === "firing" ? "当前没有触发中的告警" : "没有告警规则"} />}
        />
      </Card>

      <div className="grid cols-2">
        <Card flush title="抓取目标" sub="Prometheus targets">
          <DataTable
            rows={targets}
            rowKey={(row) => `${row.job}-${row.instance}`}
            columns={[
              { key: "health", header: "", width: 20, render: (row) => <span className={`dot ${row.health === "up" ? "dot-up" : "dot-down"}`} /> },
              { key: "job", header: "Job", render: (row) => <span className="strong">{row.job}</span> },
              { key: "instance", header: "实例", render: (row) => <span className="mono small">{row.instance}</span> },
              {
                key: "scrape",
                header: "抓取",
                align: "right",
                render: (row) =>
                  row.health === "up" ? (
                    <span className="small dim">{milliseconds(row.scrapeDurationMs)}</span>
                  ) : (
                    <span className="small warn-text">失败</span>
                  ),
              },
            ]}
          />
        </Card>

        <Card title="Grafana 仪表盘" sub="点击在浏览器中打开">
          <div className="list">
            {data?.dashboards.map((item) => (
              <button
                key={item.uid}
                type="button"
                className="list-item"
                onClick={() => {
                  if (settings.mode === "demo") {
                    showToast("演示数据：Grafana 地址未配置，链接不会打开");
                    return;
                  }
                  window.open(item.url, "_blank", "noopener,noreferrer");
                }}
              >
                <span className="list-title">
                  <Icon name="dashboard" size={12} /> {item.title}
                  <span className="spacer" />
                  <Icon name="external" size={11} />
                </span>
                <span className="list-sub">
                  {item.folder} · {num(item.panels)} 个面板 · 更新于 {relTime(item.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card title="时序概览" sub="最近 48 个采样点，来自 Prometheus 查询结果">
        <div className="grid cols-3">
          {data?.series.map((item) => (
            <div key={item.name} className="stack" style={{ gap: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono small strong">{item.name}</span>
                <span className="small dim">{item.unit}</span>
              </div>
              <div className="small dim mono truncate">
                {Object.entries(item.labels)
                  .map(([key, value]) => `${key}="${value}"`)
                  .join(" ")}
              </div>
              <Sparkline points={item.points} height={48} />
              <div className="metric-strip">
                <span className="value">{fixed(item.current, item.current < 10 ? 2 : 0)}</span>
                <span className="label">当前</span>
                <span className="label">
                  均值 {fixed(item.avg, 1)} · 峰值 {fixed(item.max, 1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
