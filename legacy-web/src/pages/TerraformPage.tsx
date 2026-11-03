import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Empty, KvList, Loading, Stat, Status, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { relTime, seconds } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, EnvName, Settings, TfAction } from "../lib/types";

const ACTION_TONE: Record<TfAction, "ok" | "warn" | "err" | "info" | "plain"> = {
  create: "ok",
  update: "warn",
  replace: "warn",
  delete: "err",
  read: "plain",
};

const ACTION_LABEL: Record<TfAction, string> = {
  create: "新建",
  update: "更新",
  replace: "替换",
  delete: "删除",
  read: "读取",
};

const ENV_TONE: Record<EnvName, "info" | "warn" | "err"> = { dev: "info", staging: "warn", prod: "err" };
const ENV_LABEL: Record<EnvName, string> = { dev: "开发", staging: "预发", prod: "生产" };

const RUN_TONE: Record<string, StatusTone> = { applied: "ok", planned: "warn", failed: "err", never: "idle" };
const RUN_LABEL: Record<string, string> = { applied: "已应用", planned: "已计划", failed: "失败", never: "从未运行" };

export function TerraformPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.terraform(), clientSignature(settings.mode, settings.agentUrl, "terraform"));
  const data = resource.data;
  const workspaces = data?.workspaces ?? [];

  const defaultName = useMemo(() => {
    const dirty = workspaces.find((item) => item.drift.create + item.drift.update + item.drift.delete > 0);
    return dirty?.name ?? workspaces[0]?.name ?? null;
  }, [workspaces]);

  const [picked, setPicked] = useState<string | null>(null);
  const current = workspaces.find((item) => item.name === (picked ?? defaultName)) ?? null;
  const changes = current ? (data?.changes[current.name] ?? []) : [];

  const totalResources = workspaces.reduce((sum, item) => sum + item.resources, 0);
  const driftTotal = workspaces.reduce((sum, item) => sum + item.drift.create + item.drift.update + item.drift.delete, 0);
  const drifted = workspaces.filter((item) => item.drift.create + item.drift.update + item.drift.delete > 0);
  const latestRun = [...workspaces].sort((a, b) => b.lastRun.localeCompare(a.lastRun))[0] ?? null;

  if (resource.loading && !data) return <Loading label="正在读取 Terraform 状态…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到 Terraform 数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      {data?.note && <Banner tone="warn">{data.note}</Banner>}
      {driftTotal > 0 && (
        <Banner tone="warn">
          <strong>{drifted.map((item) => item.name).join("、")}</strong> 与远端状态存在漂移，共 {driftTotal} 项变更待确认。先 <span className="mono">plan</span> 再 <span className="mono">apply</span>。
        </Banner>
      )}

      <div className="grid cols-4">
        <Stat icon="terraform" label="Workspace" value={String(workspaces.length)} foot={<span>{drifted.length} 个有待变更</span>} />
        <Stat icon="server" label="管理资源" value={String(totalResources)} foot={<span>来自 4 个状态文件</span>} />
        <Stat icon="activity" label="待变更" value={String(driftTotal)} foot={<span>新建 / 更新 / 删除</span>} />
        <Stat
          icon="clock"
          label="最近一次运行"
          value={latestRun ? RUN_LABEL[latestRun.lastRunStatus] : "—"}
          foot={
            <span>
              {latestRun ? `${relTime(latestRun.lastRun)} · 耗时 ${seconds(latestRun.lastRunDurationSec)}` : "暂无运行记录"}
            </span>
          }
        />
      </div>

      <div className="split">
        <Card title="Workspace" sub="选择查看变更预览">
          <div className="list">
            {workspaces.map((item) => {
              const count = item.drift.create + item.drift.update + item.drift.delete;
              return (
                <button
                  key={item.name}
                  type="button"
                  className={current?.name === item.name ? "list-item active" : "list-item"}
                  onClick={() => setPicked(item.name)}
                >
                  <span className="list-title">
                    <span className={`dot ${item.lastRunStatus === "failed" ? "dot-down" : count > 0 ? "dot-warn" : "dot-up"}`} />
                    {item.name}
                    <Badge tone={ENV_TONE[item.env]}>{ENV_LABEL[item.env]}</Badge>
                  </span>
                  <span className="list-sub">
                    {item.resources} 个资源 · state v{item.stateVersion}
                    {count > 0 ? ` · ${count} 项待变更` : " · 一致"}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="stack">
          <Card
            flush
            title={current ? `${current.name} · 变更预览` : "变更预览"}
            sub={current ? `上次运行 ${relTime(current.lastRun)} · 耗时 ${seconds(current.lastRunDurationSec)}` : undefined}
            actions={
              current && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => announceCommand(`terraform -chdir=${current.name} plan -detailed-exitcode`, settings.mode)}
                  >
                    <Icon name="terminal" size={13} /> plan
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => announceCommand(`terraform -chdir=${current.name} apply plan.tfplan`, settings.mode)}
                  >
                    <Icon name="play" size={13} /> apply
                  </button>
                </>
              )
            }
          >
            <DataTable
              rows={changes}
              rowKey={(row) => row.address}
              columns={[
                { key: "action", header: "操作", width: 72, render: (row) => <Badge tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</Badge> },
                {
                  key: "address",
                  header: "资源地址",
                  render: (row) => (
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="mono strong" style={{ overflowWrap: "anywhere" }}>
                        {row.address}
                      </span>
                      <span className="small dim">{row.detail}</span>
                    </div>
                  ),
                },
                { key: "module", header: "模块", render: (row) => <span className="small dim mono">{row.module}</span> },
                { key: "provider", header: "Provider", render: (row) => <Badge mono>{row.provider}</Badge> },
              ]}
              empty={<Empty icon="check" title="没有待执行的变更" hint="状态文件与远端基础设施一致" />}
            />
          </Card>

          {current && (
            <Card title="状态详情">
              <KvList
                rows={[
                  { key: "环境", value: <Badge tone={ENV_TONE[current.env]}>{ENV_LABEL[current.env]}</Badge> },
                  { key: "Backend", value: <span className="mono">{current.backend}</span> },
                  { key: "State 版本", value: String(current.stateVersion) },
                  { key: "资源数量", value: String(current.resources) },
                  {
                    key: "上次运行",
                    value: (
                      <Status tone={RUN_TONE[current.lastRunStatus]}>
                        {RUN_LABEL[current.lastRunStatus]} · {relTime(current.lastRun)}
                      </Status>
                    ),
                  },
                  {
                    key: "漂移",
                    value: `${current.drift.create} 新建 / ${current.drift.update} 更新 / ${current.drift.delete} 删除`,
                  },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
