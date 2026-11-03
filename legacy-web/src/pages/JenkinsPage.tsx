import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Bar, BuildStrip, Card, DataTable, Empty, Loading, Stat, Status, Tabs, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { relTime, seconds } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { BuildResult, DevopsClient, Settings } from "../lib/types";

const RESULT_TONE: Record<BuildResult, StatusTone> = {
  success: "ok",
  failure: "err",
  unstable: "warn",
  running: "idle",
  never: "idle",
};

const RESULT_LABEL: Record<BuildResult, string> = {
  success: "成功",
  failure: "失败",
  unstable: "不稳定",
  running: "构建中",
  never: "未构建",
};

const RESULT_BADGE: Record<BuildResult, "ok" | "warn" | "err" | "info" | "plain"> = {
  success: "ok",
  failure: "err",
  unstable: "warn",
  running: "info",
  never: "plain",
};

export function JenkinsPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.jenkins(), clientSignature(settings.mode, settings.agentUrl, "jenkins"));
  const [tab, setTab] = useState("jobs");

  const data = resource.data;
  const jobs = data?.jobs ?? [];
  const builds = data?.builds ?? [];
  const nodes = data?.nodes ?? [];
  const failing = jobs.filter((item) => item.status === "failure").length;
  const building = jobs.filter((item) => item.status === "running").length;
  const online = nodes.filter((item) => item.online).length;
  const avgDuration = useMemo(() => {
    const rows = builds.filter((item) => item.durationSec > 0);
    return rows.length ? rows.reduce((sum, item) => sum + item.durationSec, 0) / rows.length : 0;
  }, [builds]);

  if (resource.loading && !data) return <Loading label="正在读取 Jenkins…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到 Jenkins 数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      {data?.note && <Banner tone="warn">{data.note}</Banner>}
      {failing > 0 && (
        <Banner tone="warn">
          {jobs.filter((item) => item.status === "failure").map((item) => item.name).join("、")} 最近一次构建失败，共 {failing} 条流水线需要关注。
        </Banner>
      )}

      <div className="grid cols-4">
        <Stat icon="jenkins" label="流水线" value={String(jobs.length)} foot={<span>{jobs.filter((item) => item.enabled).length} 个启用</span>} />
        <Stat icon="alert" label="失败" value={String(failing)} foot={<span>{building} 个正在构建</span>} />
        <Stat icon="clock" label="平均构建时长" value={seconds(avgDuration)} foot={<span>最近 {builds.length} 次构建</span>} />
        <Stat icon="server" label="执行节点" value={`${online}/${nodes.length}`} foot={<span>队列 {data?.queue ?? 0} 个任务</span>} />
      </div>

      <Card
        flush
        head={
          <Tabs
            items={[
              { key: "jobs", label: "流水线", count: jobs.length },
              { key: "builds", label: "构建记录", count: builds.length },
              { key: "nodes", label: "节点", count: nodes.length },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
        actions={
          <button type="button" className="btn btn-icon btn-sm" title="刷新" onClick={resource.reload}>
            <Icon name="refresh" size={13} />
          </button>
        }
      >
        {tab === "jobs" && (
          <DataTable
            rows={jobs}
            rowKey={(row) => `${row.folder}/${row.name}`}
            columns={[
              {
                key: "name",
                header: "流水线",
                render: (row) => (
                  <div className="stack" style={{ gap: 2 }}>
                    <span className={row.enabled ? "strong" : "strong dim"}>{row.name}</span>
                    <span className="small dim">{row.folder}</span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "最近结果",
                render: (row) => (
                  <Status tone={RESULT_TONE[row.status]}>
                    {RESULT_LABEL[row.status]}
                    {row.lastBuild > 0 && <span className="dim"> · #{row.lastBuild}</span>}
                  </Status>
                ),
              },
              { key: "history", header: "最近 8 次", render: (row) => <BuildStrip history={row.history} /> },
              { key: "duration", header: "耗时", align: "right", render: (row) => (row.durationSec ? seconds(row.durationSec) : "—") },
              {
                key: "health",
                header: "健康度",
                align: "right",
                render: (row) => (
                  <div className="bar-cell">
                    <Bar value={row.health} tone={row.health >= 80 ? "good" : row.health >= 60 ? "high" : "critical"} />
                    <span className="bar-value">{row.health}</span>
                  </div>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (row) => (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!row.enabled}
                    onClick={() => announceCommand(`POST /job/${row.name}/build`, settings.mode)}
                  >
                    <Icon name="play" size={12} /> 构建
                  </button>
                ),
              },
            ]}
            empty={<Empty icon="jenkins" title="没有流水线" />}
          />
        )}

        {tab === "builds" && (
          <DataTable
            rows={builds}
            rowKey={(row) => `${row.job}-${row.number}`}
            columns={[
              { key: "job", header: "流水线", render: (row) => <span className="strong">{row.job}</span> },
              { key: "number", header: "编号", render: (row) => <span className="mono">#{row.number}</span> },
              { key: "result", header: "结果", render: (row) => <Badge tone={RESULT_BADGE[row.result]}>{RESULT_LABEL[row.result]}</Badge> },
              { key: "started", header: "开始时间", render: (row) => <span className="small dim">{relTime(row.startedAt)}</span> },
              { key: "duration", header: "耗时", align: "right", render: (row) => (row.durationSec ? seconds(row.durationSec) : <span className="dim">进行中</span>) },
              { key: "culprit", header: "触发者", render: (row) => <span className="small dim">{row.culprit ?? "—"}</span> },
              { key: "branch", header: "分支", render: (row) => <span className="mono small">{row.branch ?? "—"}</span> },
            ]}
            empty={<Empty icon="jenkins" title="没有构建记录" />}
          />
        )}

        {tab === "nodes" && (
          <DataTable
            rows={nodes}
            rowKey={(row) => row.name}
            columns={[
              { key: "name", header: "节点", render: (row) => <span className="strong mono">{row.name}</span> },
              { key: "online", header: "状态", render: (row) => <Status tone={row.online ? "ok" : "err"}>{row.online ? "在线" : "离线"}</Status> },
              { key: "executors", header: "执行器", align: "right", render: (row) => `${row.busy} / ${row.executors}` },
              { key: "labels", header: "标签", render: (row) => <span className="mono small dim">{row.labels}</span> },
            ]}
            empty={<Empty icon="server" title="没有节点" />}
          />
        )}
      </Card>
    </div>
  );
}
