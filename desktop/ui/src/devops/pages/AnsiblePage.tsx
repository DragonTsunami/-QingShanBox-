import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Empty, Loading, SearchInput, Stat, Status, Tabs, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { milliseconds, num, relTime, seconds } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { AnsibleHost, DevopsClient, Settings } from "../lib/types";

const HOST_TONE: Record<AnsibleHost["lastResult"], StatusTone> = { ok: "ok", failed: "err", unreachable: "err", never: "idle" };
const HOST_LABEL: Record<AnsibleHost["lastResult"], string> = { ok: "正常", failed: "失败", unreachable: "不可达", never: "未执行" };

const TASK_TONE = { ok: "ok", changed: "warn", failed: "bad", skipped: "" } as const;

export function AnsiblePage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.ansible(), clientSignature(settings.mode, settings.agentUrl, "ansible"));
  const [tab, setTab] = useState("hosts");
  const [query, setQuery] = useState("");

  const data = resource.data;
  const hosts = data?.hosts ?? [];
  const playbooks = data?.playbooks ?? [];
  const reachable = hosts.filter((item) => item.reachable);
  const run = data?.recentRun;

  const filteredHosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? hosts.filter((row) => `${row.name} ${row.group} ${row.address}`.toLowerCase().includes(needle)) : hosts;
  }, [hosts, query]);

  const filteredPlaybooks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? playbooks.filter((row) => `${row.name} ${row.hosts}`.toLowerCase().includes(needle)) : playbooks;
  }, [playbooks, query]);

  if (resource.loading && !data) return <Loading label="正在读取 Ansible 清单…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到 Ansible 数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      {data?.note && <Banner tone="warn">{data.note}</Banner>}
      {run?.status === "failed" && (
        <Banner tone="warn">
          最近一次 <span className="mono">{run.playbook}</span> 在 {relTime(run.startedAt)} 失败：
          {run.tasks.find((task) => task.status === "failed")?.detail ?? "查看任务明细"}。
        </Banner>
      )}

      <div className="grid cols-4">
        <Stat icon="ansible" label="主机" value={String(hosts.length)} foot={<span>{reachable.length} 可达 · {hosts.length - reachable.length} 不可达</span>} />
        <Stat icon="server" label="分组" value={String(new Set(hosts.map((item) => item.group)).size)} foot={<span>web / api / db / cache …</span>} />
        <Stat icon="terminal" label="Playbook" value={String(playbooks.length)} foot={<span>{playbooks.filter((item) => item.status === "failed").length} 个最近失败</span>} />
        <Stat
          icon="clock"
          label="最近运行"
          value={run ? seconds(playbooks.find((item) => item.name === run.playbook)?.durationSec ?? 0) : "—"}
          foot={<span>{run ? `${run.playbook} · ${run.tasks.length} 个任务` : "尚未运行"}</span>}
        />
      </div>

      <Card
        flush
        head={
          <Tabs
            items={[
              { key: "hosts", label: "主机", count: hosts.length },
              { key: "playbooks", label: "Playbook", count: playbooks.length },
              { key: "run", label: "最近运行" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
        actions={
          <>
            {tab !== "run" && <SearchInput value={query} onChange={setQuery} placeholder="主机 / 分组 / 剧本" />}
            <button type="button" className="btn btn-icon btn-sm" title="刷新" onClick={resource.reload}>
              <Icon name="refresh" size={13} />
            </button>
          </>
        }
      >
        {tab === "hosts" && (
          <DataTable
            rows={filteredHosts}
            rowKey={(row) => row.name}
            columns={[
              { key: "name", header: "主机", render: (row) => <span className="strong mono">{row.name}</span> },
              { key: "group", header: "分组", render: (row) => <Badge>{row.group}</Badge> },
              { key: "address", header: "地址", render: (row) => <span className="mono dim">{row.address}</span> },
              {
                key: "reach",
                header: "连通性",
                render: (row) => <Status tone={row.reachable ? "ok" : "err"}>{row.reachable ? "可连接" : "不可达"}</Status>,
              },
              { key: "last", header: "上次结果", render: (row) => <Status tone={HOST_TONE[row.lastResult]}>{HOST_LABEL[row.lastResult]}</Status> },
            ]}
            empty={<Empty icon="search" title="没有匹配的主机" />}
          />
        )}

        {tab === "playbooks" && (
          <DataTable
            rows={filteredPlaybooks}
            rowKey={(row) => row.path}
            columns={[
              {
                key: "name",
                header: "剧本",
                render: (row) => (
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="strong">{row.name}</span>
                    <span className="mono dim small">{row.path}</span>
                  </div>
                ),
              },
              { key: "hosts", header: "目标", render: (row) => <Badge mono>{row.hosts}</Badge> },
              { key: "tasks", header: "任务数", align: "right", render: (row) => num(row.tasks) },
              {
                key: "status",
                header: "状态",
                render: (row) =>
                  row.status === "never" ? (
                    <span className="dim">未运行</span>
                  ) : (
                    <Status tone={row.status === "success" ? "ok" : "err"}>
                      {row.status === "success" ? "成功" : "失败"} · {row.lastRun ? relTime(row.lastRun) : "—"}
                    </Status>
                  ),
              },
              { key: "duration", header: "耗时", align: "right", render: (row) => (row.durationSec ? seconds(row.durationSec) : "—") },
              {
                key: "action",
                header: "",
                align: "right",
                render: (row) => (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => announceCommand(`ansible-playbook -i inventory/prod.ini ${row.path} --check`, settings.mode)}
                  >
                    <Icon name="play" size={12} /> 预演
                  </button>
                ),
              },
            ]}
            empty={<Empty icon="search" title="没有匹配的剧本" />}
          />
        )}

        {tab === "run" && run && (
          <div style={{ padding: "4px 18px 14px" }}>
            <div className="row" style={{ justifyContent: "space-between", padding: "10px 0" }}>
              <div>
                <div className="card-title">{run.playbook}</div>
                <div className="card-sub">
                  {relTime(run.startedAt)} · {run.tasks.length} 个任务
                </div>
              </div>
              <Status tone={run.status === "success" ? "ok" : "err"}>{run.status === "success" ? "全部成功" : "存在失败"}</Status>
            </div>
            <div className="timeline">
              {run.tasks.map((task, index) => (
                <div className="timeline-item" key={`${task.host}-${task.task}-${index}`}>
                  <span className={`timeline-dot ${TASK_TONE[task.status]}`} />
                  <div className="timeline-main">
                    <div className="timeline-title">{task.task}</div>
                    <div className="timeline-meta">
                      {task.host}
                      {task.detail ? ` · ${task.detail}` : ""}
                    </div>
                  </div>
                  <span className="small dim nowrap">
                    {task.status === "failed" ? <span className="warn-text">failed</span> : task.status} · {milliseconds(task.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
