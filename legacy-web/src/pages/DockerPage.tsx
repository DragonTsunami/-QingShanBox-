import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Drawer, Empty, KvList, Loading, PctCell, SearchInput, Stat, Status, Tabs, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { size, num, fixed, percent } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, DockerContainer, Settings } from "../lib/types";

const STATE_TONE: Record<DockerContainer["state"], StatusTone> = {
  running: "ok",
  exited: "err",
  paused: "warn",
  restarting: "warn",
};

const STATE_LABEL: Record<DockerContainer["state"], string> = {
  running: "运行中",
  exited: "已退出",
  paused: "已暂停",
  restarting: "重启中",
};

export function DockerPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.docker(), clientSignature(settings.mode, settings.agentUrl, "docker"));
  const [tab, setTab] = useState("containers");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [selected, setSelected] = useState<DockerContainer | null>(null);

  const data = resource.data;
  const containers = data?.containers ?? [];
  const running = containers.filter((item) => item.state === "running");
  const totalCpu = running.reduce((sum, item) => sum + item.cpuPercent, 0);
  const totalMem = containers.reduce((sum, item) => sum + item.memMb, 0);
  const totalLimit = containers.reduce((sum, item) => sum + item.memLimitMb, 0);
  const imageSize = (data?.images ?? []).reduce((sum, item) => sum + item.sizeMb, 0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return containers.filter((item) => {
      if (project && item.compose !== project) return false;
      if (!needle) return true;
      return `${item.name} ${item.image} ${item.state} ${item.ports.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [containers, project, query]);

  const mode = settings.mode;

  if (resource.loading && !data) return <Loading label="正在读取 Docker Engine…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到 Docker 数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      {data?.note && <Banner tone="warn">{data.note}</Banner>}

      <div className="grid cols-4">
        <Stat
          icon="box"
          label="容器"
          value={String(containers.length)}
          foot={<span>{running.length} 运行中 · {containers.length - running.length} 停止</span>}
        />
        <Stat icon="cpu" label="CPU 合计" value={fixed(totalCpu, 1)} unit="%" foot={<span>{running.length} 个活跃容器</span>} />
        <Stat
          icon="drive"
          label="内存占用"
          value={size(totalMem)}
          foot={<span>上限 {size(totalLimit)} · {Math.round(percent(totalMem, totalLimit))}%</span>}
        />
        <Stat icon="server" label="镜像" value={String(data?.images.length ?? 0)} foot={<span>占用 {size(imageSize)}</span>} />
      </div>

      <div className="split">
        <div className="stack">
          <Card title="Compose 项目" sub="按项目过滤容器">
            <div className="list">
              <button type="button" className={project === null ? "list-item active" : "list-item"} onClick={() => setProject(null)}>
                <span className="list-title">
                  <Icon name="box" size={13} /> 全部容器
                </span>
                <span className="list-sub">{containers.length} 个容器</span>
              </button>
              {(data?.projects ?? []).map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={project === item.name ? "list-item active" : "list-item"}
                  onClick={() => setProject(item.name === project ? null : item.name)}
                >
                  <span className="list-title">
                    <span className={`dot ${item.status === "running" ? "dot-up" : item.status === "partial" ? "dot-warn" : "dot-idle"}`} />
                    {item.name}
                  </span>
                  <span className="list-sub">
                    {item.running}/{item.services} 服务 · {item.path}
                  </span>
                </button>
              ))}
            </div>
          </Card>
          <Card title="最近异常" sub="非 running 状态或存在重启">
            <div className="stack" style={{ gap: 10 }}>
              {containers
                .filter((item) => item.state !== "running" || item.restarts > 0)
                .slice(0, 4)
                .map((item) => (
                  <div key={item.id} className="row" style={{ justifyContent: "space-between" }}>
                    <Status tone={STATE_TONE[item.state]}>{item.name}</Status>
                    <span className="small dim">
                      {item.state === "running" ? `重启 ${item.restarts} 次` : STATE_LABEL[item.state]}
                    </span>
                  </div>
                ))}
              {containers.length > 0 && containers.every((item) => item.state === "running" && item.restarts === 0) && (
                <div className="small dim">全部容器运行正常。</div>
              )}
              {containers.length === 0 && <div className="small dim">没有采集到容器，先确认 Docker daemon 是否在运行。</div>}
            </div>
          </Card>
        </div>

        <Card
          flush
          head={
            <Tabs
              items={[
                { key: "containers", label: "容器", count: containers.length },
                { key: "images", label: "镜像", count: data?.images.length ?? 0 },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
          actions={
            <>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={tab === "containers" ? "名称 / 镜像 / 端口" : "仓库 / 标签"}
              />
              <button type="button" className="btn btn-icon btn-sm" title="刷新" onClick={resource.reload}>
                <Icon name="refresh" size={13} />
              </button>
            </>
          }
        >
          {tab === "containers" ? (
            <DataTable
              rows={filtered}
              rowKey={(row) => row.id}
              onRowClick={(row) => setSelected(row)}
              selectedKey={selected?.id ?? null}
              columns={[
                {
                  key: "name",
                  header: "容器",
                  render: (row) => (
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{row.name}</span>
                      <span className="mono dim truncate" style={{ maxWidth: 320 }}>
                        {row.image}
                      </span>
                    </div>
                  ),
                },
                {
                  key: "state",
                  header: "状态",
                  render: (row) => (
                    <Status tone={STATE_TONE[row.state]}>
                      {STATE_LABEL[row.state]}
                      {row.health === "unhealthy" && <span className="warn-text"> · 不健康</span>}
                    </Status>
                  ),
                },
                {
                  key: "cpu",
                  header: "CPU",
                  align: "right",
                  render: (row) => (row.state === "running" ? `${fixed(row.cpuPercent, 1)}%` : "—"),
                },
                {
                  key: "mem",
                  header: "内存",
                  align: "right",
                  render: (row) =>
                    row.state === "running" ? <PctCell value={percent(row.memMb, row.memLimitMb)} text={size(row.memMb)} /> : "—",
                },
                {
                  key: "ports",
                  header: "端口",
                  render: (row) => <span className="mono dim nowrap">{row.ports[0] ?? "—"}</span>,
                },
              ]}
              empty={<Empty icon="box" title="没有匹配的容器" hint={project ? `项目 ${project} 下没有容器` : "换个关键字试试"} />}
            />
          ) : (
            <DataTable
              rows={(data?.images ?? []).filter((row) => !query.trim() || `${row.repo}:${row.tag}`.toLowerCase().includes(query.trim().toLowerCase()))}
              rowKey={(row) => row.id}
              columns={[
                { key: "repo", header: "仓库", render: (row) => <span className="strong mono">{row.repo}</span> },
                { key: "tag", header: "标签", render: (row) => <Badge mono>{row.tag}</Badge> },
                { key: "size", header: "大小", align: "right", render: (row) => size(row.sizeMb) },
                { key: "used", header: "使用中", align: "right", render: (row) => (row.usedBy ? num(row.usedBy) : <span className="dim">0</span>) },
              ]}
            />
          )}
        </Card>
      </div>

      <Drawer open={selected !== null} title={selected?.name ?? ""} sub={selected?.image} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <KvList
              rows={[
                { key: "容器 ID", value: <span className="mono">{selected.id}</span> },
                { key: "状态", value: <Status tone={STATE_TONE[selected.state]}>{STATE_LABEL[selected.state]}</Status> },
                { key: "健康检查", value: selected.health === "none" ? <span className="dim">未配置</span> : selected.health },
                { key: "运行时长", value: selected.uptime },
                { key: "CPU / 内存", value: `${fixed(selected.cpuPercent, 1)}% · ${size(selected.memMb)} / ${size(selected.memLimitMb)}` },
                { key: "端口", value: <span className="mono">{selected.ports.join("、") || "—"}</span> },
                { key: "Compose", value: selected.compose ?? "独立容器" },
                { key: "重启次数", value: num(selected.restarts) },
              ]}
            />
            <div className="row wrap">
              <button type="button" className="btn btn-sm" onClick={() => announceCommand(`docker logs --tail 200 ${selected.name}`, mode)}>
                <Icon name="terminal" size={13} /> 查看日志
              </button>
              <button type="button" className="btn btn-sm" onClick={() => announceCommand(`docker inspect ${selected.name}`, mode)}>
                <Icon name="info" size={13} /> 检查配置
              </button>
              <button type="button" className="btn btn-sm" onClick={() => announceCommand(`docker restart ${selected.name}`, mode)}>
                <Icon name="restart" size={13} /> 重启容器
              </button>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
