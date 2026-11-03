import { useEffect, useMemo, useState } from "react";
import { DEFAULT_DOCKER_CONNECTION, createDockerConnection, isDockerHost, loadDockerConnections, saveDockerConnections } from "../lib/docker-connections";
import { DEFAULT_DOCKER_THRESHOLDS, loadDockerThresholds, saveDockerThresholds, type DockerThresholds } from "../lib/docker-thresholds";
import { DeleteConnectionDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";
import { Badge, Banner, Bar, Card, DataTable, Drawer, Empty, KvList, Loading, SearchInput, Status, Tabs, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { size, num, fixed, percent } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, DockerConnection, DockerContainer, DockerSnapshot, Settings } from "../lib/types";

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

type GaugeTone = "good" | "high" | "critical";

const EMPTY_DOCKER: DockerSnapshot = {
  containers: [],
  images: [],
  projects: [],
  cpuCount: 1,
  memoryTotalMb: 1,
};

function gaugeTone(value: number, limit: number): GaugeTone {
  if (value >= limit) return "critical";
  if (value >= limit * 0.8) return "high";
  return "good";
}

const TONE_LABEL: Record<GaugeTone, string> = {
  good: "正常",
  high: "接近阈值",
  critical: "已超阈值",
};

const TONE_BADGE: Record<GaugeTone, "ok" | "warn" | "err"> = {
  good: "ok",
  high: "warn",
  critical: "err",
};

function DockerGauge({
  label,
  value,
  unit,
  foot,
  bar,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: string;
  bar: number;
  tone: GaugeTone;
}) {
  return (
    <div className={`docker-gauge ${tone}`}>
      <div className="docker-gauge-head">
        <span>{label}</span>
        <Badge tone={TONE_BADGE[tone]}>{TONE_LABEL[tone]}</Badge>
      </div>
      <div className="docker-gauge-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <Bar value={bar} tone={tone === "critical" ? "critical" : tone === "high" ? "high" : "good"} />
      <div className="docker-gauge-foot">{foot}</div>
    </div>
  );
}

function DockerConnectionDialog({
  open,
  draft,
  error,
  testing,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: { name: string; host: string };
  error: string;
  testing: boolean;
  onChange: (next: { name: string; host: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="jenkins-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="jenkins-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="jenkins-modal-head">
          <div>
            <h2>添加 Docker 连接</h2>
            <p>填写远程 Docker Engine 地址，连接成功后才保存。本机 Docker 请使用已有的「本机 Docker」连接。</p>
          </div>
          <button type="button" className="btn btn-icon btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="connection-form">
          <label className="field">
            <span className="field-label">连接名称</span>
            <input
              className="input"
              value={draft.name}
              placeholder="例如：上海生产 Docker"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Docker Engine 地址</span>
            <input
              className="input"
              value={draft.host}
              placeholder="tcp://10.0.0.5:2375 / ssh://user@host / npipe:////./pipe/docker_engine"
              onChange={(event) => onChange({ ...draft, host: event.target.value })}
            />
            <span className="field-hint">远程 Docker 需要在目标机开放 TCP API 或配置 SSH；生产环境建议只开 TLS 端口与只读权限。</span>
          </label>
          {error && <div className="jenkins-modal-error">{error}</div>}
        </div>
        <div className="jenkins-modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={testing}>取消</button>
          <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={testing}>
            {testing ? "正在连接…" : "添加连接"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DockerPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const [connections, setConnections] = useState<DockerConnection[]>(() => loadDockerConnections());
  const [connectionId, setConnectionId] = useState("");
  const connection = connections.find((item) => item.id === connectionId) ?? null;
  const resource = useResource(
    () => (connection ? client.docker(connection) : Promise.resolve(EMPTY_DOCKER)),
    `${clientSignature(settings.mode, settings.agentUrl, "docker")}:${connection?.id ?? "list"}`,
  );
  const [tab, setTab] = useState("containers");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [selected, setSelected] = useState<DockerContainer | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", host: "" });
  const [formError, setFormError] = useState("");
  const [testing, setTesting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DockerConnection | null>(null);
  const [thresholds, setThresholds] = useState<DockerThresholds>(() => loadDockerThresholds(connection?.id ?? ""));
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState<DockerThresholds>(DEFAULT_DOCKER_THRESHOLDS);
  const [thresholdError, setThresholdError] = useState("");

  useEffect(() => {
    setThresholds(loadDockerThresholds(connection?.id ?? ""));
  }, [connection?.id]);

  const openThresholds = () => {
    setThresholdDraft({ ...thresholds });
    setThresholdError("");
    setThresholdOpen(true);
  };

  const applyThresholds = () => {
    const next: DockerThresholds = {
      cpu: Math.round(thresholdDraft.cpu),
      memory: Math.round(thresholdDraft.memory),
      restarts: Math.round(thresholdDraft.restarts),
      stopped: Math.round(thresholdDraft.stopped),
    };
    if (next.cpu < 1 || next.cpu > 100 || next.memory < 1 || next.memory > 100) {
      setThresholdError("CPU、内存阈值需在 1–100% 之间");
      return;
    }
    if (next.restarts < 0 || next.stopped < 0) {
      setThresholdError("重启次数、停止容器数不能为负数");
      return;
    }
    setThresholds(next);
    saveDockerThresholds(connection?.id ?? "", next);
    setThresholdOpen(false);
  };

  const addConnection = async () => {
    if (!draft.name.trim()) {
      setFormError("连接名称不能为空");
      return;
    }
    if (!isDockerHost(draft.host)) {
      setFormError("新连接必须填写 Docker Engine 地址，例如 tcp://10.0.0.5:2375 或 ssh://user@host");
      return;
    }
    const next = createDockerConnection(draft);
    setTesting(true);
    setFormError("");
    try {
      const probe = await client.docker(next);
      if (probe.note) throw new Error(probe.note);
    } catch (error) {
      setFormError(`无法连接该 Docker Engine：${error instanceof Error ? error.message : "请检查地址与权限"}`);
      setTesting(false);
      return;
    }
    const all = [...connections, next];
    setConnections(all);
    saveDockerConnections(all);
    setAddOpen(false);
    setDraft({ name: "", host: "" });
    setFormError("");
    setTesting(false);
  };

  const closeAdd = () => {
    if (testing) return;
    setAddOpen(false);
    setDraft({ name: "", host: "" });
    setFormError("");
    setTesting(false);
  };

  const openAdd = () => {
    setDraft({ name: "", host: "" });
    setFormError("");
    setTesting(false);
    setAddOpen(true);
  };

  const removeConnection = (target: DockerConnection) => {
    if (target.id === DEFAULT_DOCKER_CONNECTION.id) return;
    const next = connections.filter((item) => item.id !== target.id);
    setConnections(next);
    saveDockerConnections(next);
    if (connectionId === target.id) setConnectionId("");
    setPendingDelete(null);
  };

  const data = resource.data;
  const containers = data?.containers ?? [];
  const running = containers.filter((item) => item.state === "running");
  const totalCpu = running.reduce((sum, item) => sum + item.cpuPercent, 0);
  const totalMem = containers.reduce((sum, item) => sum + item.memMb, 0);
  const cpuCount = data?.cpuCount && data.cpuCount > 0 ? data.cpuCount : 1;
  const hostMemoryMb = data?.memoryTotalMb && data.memoryTotalMb > 0 ? data.memoryTotalMb : 1;
  const cpuPercent = totalCpu / cpuCount;
  const memoryPercent = percent(totalMem, hostMemoryMb);
  const imageSize = (data?.images ?? []).reduce((sum, item) => sum + item.sizeMb, 0);
  const stopped = containers.length - running.length;
  const totalRestarts = containers.reduce((sum, item) => sum + item.restarts, 0);
  const cpuTone = gaugeTone(cpuPercent, thresholds.cpu);
  const memoryTone = gaugeTone(memoryPercent, thresholds.memory);
  const restartTone = thresholds.restarts > 0 ? gaugeTone(totalRestarts, thresholds.restarts) : "good";
  const stoppedTone = thresholds.stopped > 0
    ? (stopped >= thresholds.stopped ? "critical" : stopped >= thresholds.stopped * 0.8 ? "high" : "good")
    : "good";
  const alertItems: string[] = [];
  if (thresholds.cpu > 0 && cpuPercent >= thresholds.cpu) {
    alertItems.push(`CPU 占用 ${fixed(cpuPercent, 2)}% 超过阈值 ${thresholds.cpu}%`);
  }
  if (thresholds.memory > 0 && memoryPercent >= thresholds.memory) {
    alertItems.push(`内存占用 ${fixed(memoryPercent, 1)}% 超过阈值 ${thresholds.memory}%`);
  }
  if (thresholds.restarts > 0 && totalRestarts >= thresholds.restarts) {
    alertItems.push(`容器累计重启 ${totalRestarts} 次，达到阈值 ${thresholds.restarts} 次`);
  }
  if (thresholds.stopped > 0 && stopped >= thresholds.stopped) {
    alertItems.push(`非运行容器 ${stopped} 个，达到阈值 ${thresholds.stopped} 个`);
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return containers.filter((item) => {
      if (project && item.compose !== project) return false;
      if (!needle) return true;
      return `${item.name} ${item.image} ${item.state} ${item.ports.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [containers, project, query]);

  const mode = settings.mode;

  if (!connection) {
    return (
      <div className="page">
        <Card
          title="Docker 连接"
          sub="像 GitHub 仓库一样逐个打开；每个连接独立保存，不使用下拉切换"
          actions={<button type="button" className="btn btn-primary" onClick={openAdd}>添加连接</button>}
        >
          <p className="gh-add-hint">
            选择一张连接卡进入它的仪表盘与容器列表。新增连接会先测试 Docker Engine，成功后才保存。
          </p>
        </Card>

        {connections.length === 0 ? (
          <Card>
            <Empty
              icon="box"
              title="还没有 Docker 连接"
              hint="添加一个远程 Docker Engine，或者恢复内置的本机连接。"
              action={<button type="button" className="btn btn-primary" onClick={openAdd}>添加连接</button>}
            />
          </Card>
        ) : (
          <div className="gh-grid">
            {connections.map((item) => (
              <article key={item.id} className="gh-card">
                <button type="button" className="gh-card-main" onClick={() => setConnectionId(item.id)}>
                  <div className="gh-card-top">
                    <span className="gh-owner">{item.id === DEFAULT_DOCKER_CONNECTION.id ? "LOCAL" : "REMOTE"}/</span>
                    <strong className="gh-card-name">{item.name}</strong>
                  </div>
                  <p className="gh-card-desc">{item.host || "agent 本机默认 Docker 引擎"}</p>
                  <div className="gh-card-foot">
                    <span>Docker Engine</span>
                    <span className="spacer" />
                    <span>点击打开</span>
                  </div>
                </button>
                {item.id !== DEFAULT_DOCKER_CONNECTION.id ? (
                  <button
                    type="button"
                    className="gh-card-delete"
                    title="删除连接"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete(item);
                    }}
                  >
                    <Icon name="x" size={12} /> 删除
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <DockerConnectionDialog
          open={addOpen}
          draft={draft}
          error={formError}
          testing={testing}
          onChange={setDraft}
          onClose={closeAdd}
          onSubmit={addConnection}
        />
        <DeleteConnectionDialog
          open={Boolean(pendingDelete)}
          name={pendingDelete?.name ?? ""}
          kind="Docker"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete) removeConnection(pendingDelete);
          }}
        />
      </div>
    );
  }

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
      <div className="gh-detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConnectionId("")}>
          <Icon name="chevronRight" size={14} className="flip" />
          全部 Docker
        </button>
        <div className="gh-detail-title">
          <span className="gh-owner">DOCKER/</span>
          <strong>{connection.name}</strong>
        </div>
        <div className="spacer" />
        <span className="small dim mono">{connection.host || "agent 本机默认 Docker 引擎"}</span>
        {connection.id !== DEFAULT_DOCKER_CONNECTION.id ? (
          <button type="button" className="btn btn-ghost btn-sm gh-delete-btn" onClick={() => setPendingDelete(connection)}>
            <Icon name="x" size={12} /> 删除连接
          </button>
        ) : null}
      </div>
      {data?.note && <Banner tone="warn">{data.note}</Banner>}

      <div className="docker-dashboard">
        <Card
          title="Docker 仪表盘"
          sub={`${connection?.name ?? "当前连接"} · 阈值仅保存在本机`}
          actions={
            <div className="docker-dashboard-actions">
              <Badge tone={alertItems.length > 0 ? "err" : "ok"}>
                {alertItems.length > 0 ? `${alertItems.length} 项超阈值` : "全部正常"}
              </Badge>
              <button type="button" className="btn btn-sm" onClick={openThresholds}>
                <Icon name="settings" size={13} /> 阈值设置
              </button>
            </div>
          }
        >
          <div className="docker-gauge-grid">
            <DockerGauge
              label="CPU 占用"
              value={fixed(cpuPercent, 2)}
              unit="%"
              foot={`按主机 ${cpuCount} 核折算 · 阈值 ${thresholds.cpu}%`}
              bar={cpuPercent}
              tone={cpuTone}
            />
            <DockerGauge
              label="内存占用"
              value={size(totalMem)}
              foot={`Docker 主机 ${size(hostMemoryMb)} · 容器占 ${fixed(memoryPercent, 1)}%`}
              bar={memoryPercent}
              tone={memoryTone}
            />
            <DockerGauge
              label="容器数量"
              value={`${containers.length}`}
              unit="个"
              foot={`运行 ${running.length} · 已停止 ${stopped} · 停止告警阈值 ${thresholds.stopped}`}
              bar={percent(running.length, containers.length)}
              tone={stoppedTone}
            />
            <DockerGauge
              label="累计重启"
              value={num(totalRestarts)}
              unit="次"
              foot={`阈值 ${thresholds.restarts} 次 · 镜像 ${data?.images.length ?? 0} 个 / ${size(imageSize)}`}
              bar={thresholds.restarts > 0 ? percent(totalRestarts, thresholds.restarts * 2) : 0}
              tone={restartTone}
            />
          </div>
          {alertItems.length > 0 ? (
            <div className="docker-dashboard-alert">
              <Icon name="alert" size={14} />
              <span>{alertItems.join("；")}</span>
            </div>
          ) : (
            <div className="docker-dashboard-ok">
              <Icon name="check" size={14} />
              <span>所有容量与运行状态均在当前阈值内。</span>
            </div>
          )}
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
          <div className="docker-table-actions">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={tab === "containers" ? "搜索容器 / 镜像 / 端口" : "搜索仓库 / 标签"}
            />
            <button type="button" className="btn btn-icon btn-sm" title="刷新" onClick={resource.reload}>
              <Icon name="refresh" size={13} />
            </button>
          </div>
        }
      >
        <div className="docker-filter-chips">
          <button
            type="button"
            className={project === null ? "docker-chip active" : "docker-chip"}
            onClick={() => setProject(null)}
          >
            全部容器 <span>{containers.length}</span>
          </button>
          {(data?.projects ?? []).map((item) => (
            <button
              key={item.name}
              type="button"
              className={project === item.name ? "docker-chip active" : "docker-chip"}
              onClick={() => setProject(item.name === project ? null : item.name)}
            >
              <span className={`dot ${item.status === "running" ? "dot-up" : item.status === "partial" ? "dot-warn" : "dot-idle"}`} />
              {item.name} <span>{item.running}/{item.services}</span>
            </button>
          ))}
          <span className="docker-filter-total">
            {running.length} 运行中 · {stopped} 已停止
          </span>
        </div>
        {tab === "containers" ? (
          filtered.length === 0 ? (
            <Empty icon="box" title="没有匹配的容器" hint={project ? `项目 ${project} 下没有容器` : "换个关键字试试"} />
          ) : (
            <div className="docker-container-grid">
              {filtered.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="docker-container-card"
                  onClick={() => setSelected(row)}
                >
                  <span className="docker-container-card-top">
                    <span className={`dot ${row.state === "running" ? "dot-up" : row.state === "restarting" ? "dot-warn" : "dot-idle"}`} />
                    <span className="docker-container-card-name">{row.name}</span>
                    <Status tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Status>
                  </span>
                  <span className="docker-container-card-image mono">{row.image}</span>
                  <span className="docker-container-card-metrics">
                    <span>
                      <small>CPU</small>
                      <strong>{row.state === "running" ? `${fixed(row.cpuPercent, 1)}%` : "—"}</strong>
                    </span>
                    <span>
                      <small>内存</small>
                      <strong>{row.state === "running" ? size(row.memMb) : "—"}</strong>
                    </span>
                    <span>
                      <small>重启</small>
                      <strong>{num(row.restarts)}</strong>
                    </span>
                  </span>
                  <span className="docker-container-card-foot">
                    <span className="mono">{row.ports[0] ?? "无端口映射"}</span>
                    <span>查看详情 →</span>
                  </span>
                </button>
              ))}
            </div>
          )
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

      <DockerConnectionDialog
        open={addOpen}
        draft={draft}
        error={formError}
        testing={testing}
        onChange={setDraft}
        onClose={closeAdd}
        onSubmit={addConnection}
      />

      {thresholdOpen && (
        <div className="jenkins-modal-backdrop" role="presentation" onMouseDown={() => setThresholdOpen(false)}>
          <div className="jenkins-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="jenkins-modal-head">
              <div>
                <h2>仪表盘阈值</h2>
                <p>按当前连接保存；超过阈值时仪表盘和告警条会标红。</p>
              </div>
              <button type="button" className="btn btn-icon btn-sm" onClick={() => setThresholdOpen(false)}>×</button>
            </div>
            <div className="connection-form">
              <div className="connection-grid">
                <label className="field">
                  <span className="field-label">CPU 合计（%）</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={100}
                    value={thresholdDraft.cpu}
                    onChange={(event) => setThresholdDraft({ ...thresholdDraft, cpu: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">内存占用（%）</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={100}
                    value={thresholdDraft.memory}
                    onChange={(event) => setThresholdDraft({ ...thresholdDraft, memory: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">累计重启（次）</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={thresholdDraft.restarts}
                    onChange={(event) => setThresholdDraft({ ...thresholdDraft, restarts: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">非运行容器（个）</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={thresholdDraft.stopped}
                    onChange={(event) => setThresholdDraft({ ...thresholdDraft, stopped: Number(event.target.value) })}
                  />
                </label>
              </div>
              <span className="field-hint">重启次数或非运行容器填 0 表示关闭该项告警；阈值为本机连接配置，不会写入 Docker Engine。</span>
              {thresholdError && <div className="jenkins-modal-error">{thresholdError}</div>}
            </div>
            <div className="jenkins-modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setThresholdDraft({ ...DEFAULT_DOCKER_THRESHOLDS })}
              >
                恢复默认
              </button>
              <button type="button" className="btn" onClick={() => setThresholdOpen(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={applyThresholds}>保存阈值</button>
            </div>
          </div>
        </div>
      )}
      <DeleteConnectionDialog
        open={Boolean(pendingDelete)}
        name={pendingDelete?.name ?? ""}
        kind="Docker"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeConnection(pendingDelete);
        }}
      />
    </div>
  );
}
