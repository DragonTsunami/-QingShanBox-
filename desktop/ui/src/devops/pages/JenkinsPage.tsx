import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Bar, BuildStrip, Card, DataTable, Empty, Loading, Stat, Status, Tabs, type StatusTone } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { relTime, seconds } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { BuildResult, DevopsClient, JenkinsConnection, JenkinsSnapshot, Settings } from "../lib/types";
import {
  DEMO_JENKINS_CONNECTION,
  createJenkinsConnection,
  isJenkinsUrl,
  loadJenkinsConnections,
  saveJenkinsConnections,
} from "../lib/jenkins";

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

const EMPTY_JENKINS: JenkinsSnapshot = { jobs: [], builds: [], nodes: [], queue: 0 };

export function JenkinsPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const [connections, setConnections] = useState<JenkinsConnection[]>(() => {
    const saved = loadJenkinsConnections();
    if (saved.length > 0) return saved;
    return settings.mode === "demo" ? [DEMO_JENKINS_CONNECTION] : [];
  });
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", url: "", username: "", token: "" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const selected = useMemo(
    () => connections.find((connection) => connection.id === selectedId) ?? null,
    [connections, selectedId],
  );
  const resource = useResource(
    () => (selected ? client.jenkins(selected) : Promise.resolve(EMPTY_JENKINS)),
    `${clientSignature(settings.mode, settings.agentUrl, "jenkins")}:${selected?.id ?? "none"}`,
  );
  const [tab, setTab] = useState("jobs");

  const persistConnections = (next: JenkinsConnection[]) => {
    setConnections(next);
    saveJenkinsConnections(next);
    if (!next.some((connection) => connection.id === selectedId)) {
      setSelectedId(next[0]?.id ?? "");
    }
  };

  const validateDraft = () => {
    const errors: Record<string, string> = {};
    if (!draft.name.trim()) errors.name = "请填写连接名称；不必和 Jenkins 主机名一致。";
    if (!isJenkinsUrl(draft.url)) errors.url = "请填写 http:// 或 https:// 开头的 Jenkins 地址。";
    if (draft.username.trim() && !draft.token.trim()) errors.token = "填写了用户名时还需要 API Token。";
    if (!draft.username.trim() && draft.token.trim()) errors.username = "填写了 API Token 时还需要用户名。";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const addConnection = async () => {
    if (!validateDraft()) return;
    const connection = createJenkinsConnection(draft);
    setTesting(true);
    setSubmitError(null);
    try {
      await client.jenkins(connection);
      persistConnections([...connections, connection]);
      setSelectedId(connection.id);
      setDraft({ name: "", url: "", username: "", token: "" });
      setFormErrors({});
      setAdding(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "连接 Jenkins 失败，请检查地址、用户名和 Token。");
    } finally {
      setTesting(false);
    }
  };

  const removeConnection = (connectionId: string) => {
    persistConnections(connections.filter((connection) => connection.id !== connectionId));
    if (selectedId === connectionId) setSelectedId("");
  };

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

  if (!selected) {
    return (
      <div className="page">
        <section className="jenkins-hero">
          <div className="jenkins-hero-copy">
            <span className="jenkins-hero-kicker">REMOTE JENKINS</span>
            <h1>Jenkins 连接</h1>
            <p>
              每个 Jenkins 独立连接、独立打开。已保存 {connections.length} 个连接，远程只读监控。
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setAdding((value) => !value)}>
            <Icon name="plus" size={14} /> {adding ? "取消添加" : "添加连接"}
          </button>
        </section>
        <Card
          title={connections.length > 0 ? "已保存连接" : "开始连接"}
          sub="点击卡片进入对应的 Jenkins 详情"
        >
          {connections.length === 0 ? (
            <Empty
              icon="jenkins"
              title="还没有 Jenkins 连接"
              hint="添加第一个 Jenkins 地址和 API Token，之后可以保存多个并分别打开。"
              action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>添加连接</button>}
            />
          ) : (
            <div className="gh-grid">
              {connections.map((connection) => (
                <article className="gh-card" key={connection.id}>
                  <button type="button" className="gh-card-main" onClick={() => setSelectedId(connection.id)}>
                    <div className="gh-card-top">
                      <strong className="gh-card-name">{connection.name}</strong>
                    </div>
                    <p className="gh-card-desc mono">{connection.url}</p>
                    <div className="gh-card-foot">
                      <span>{connection.username || "未配置用户名"}</span>
                      <span>打开 <Icon name="chevronRight" size={12} /></span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="gh-card-remove"
                    title="移除连接"
                    aria-label={`移除 ${connection.name}`}
                    onClick={() => removeConnection(connection.id)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </Card>
        {adding ? (
          <div
            className="jenkins-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !testing) {
                setAdding(false);
                setSubmitError(null);
                setFormErrors({});
              }
            }}
          >
            <div className="jenkins-modal" role="dialog" aria-modal="true" aria-label="添加 Jenkins 连接">
              <div className="jenkins-modal-head">
                <div>
                  <h2>添加 Jenkins 连接</h2>
                  <p>填写后会先测试连接，成功才保存；失败会指出具体字段或连接原因。</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="关闭"
                  onClick={() => {
                    setAdding(false);
                    setSubmitError(null);
                    setFormErrors({});
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              <div className="jenkins-field">
                <label>名称</label>
                <input
                  className="input"
                  placeholder="例如 生产 Jenkins"
                  value={draft.name}
                  onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                />
                {formErrors.name ? <span className="jenkins-field-error">{formErrors.name}</span> : null}
              </div>

              <div className="jenkins-field">
                <label>Jenkins 地址</label>
                <input
                  className="input"
                  placeholder="https://jenkins.company.com"
                  value={draft.url}
                  onChange={(event) => setDraft((value) => ({ ...value, url: event.target.value }))}
                />
                {formErrors.url ? <span className="jenkins-field-error">{formErrors.url}</span> : null}
              </div>

              <div className="jenkins-field-row">
                <div className="jenkins-field">
                  <label>用户名</label>
                  <input
                    className="input"
                    placeholder="可选"
                    value={draft.username}
                    onChange={(event) => setDraft((value) => ({ ...value, username: event.target.value }))}
                  />
                  {formErrors.username ? <span className="jenkins-field-error">{formErrors.username}</span> : null}
                </div>
                <div className="jenkins-field">
                  <label>API Token</label>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder="可选"
                    value={draft.token}
                    onChange={(event) => setDraft((value) => ({ ...value, token: event.target.value }))}
                  />
                  {formErrors.token ? <span className="jenkins-field-error">{formErrors.token}</span> : null}
                </div>
              </div>

              {submitError ? (
                <div className="jenkins-modal-error">
                  <Icon name="alert" size={14} /> {submitError}
                </div>
              ) : null}

              <div className="jenkins-modal-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={testing}
                  onClick={() => {
                    setAdding(false);
                    setSubmitError(null);
                    setFormErrors({});
                  }}
                >
                  取消
                </button>
                <button type="button" className="btn btn-primary" disabled={testing} onClick={() => void addConnection()}>
                  {testing ? "正在连接…" : "连接并保存"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (resource.loading && !data) return <Loading label="正在读取 Jenkins…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty
          icon="alert"
          title={`连接 ${selected.name} 失败`}
          hint={`${resource.error} 请检查地址、用户名和 API Token。`}
          action={<button type="button" className="btn" onClick={resource.reload}>重试</button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="jenkins-detail-head">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedId("")}>
          <Icon name="chevronRight" size={12} /> 全部 Jenkins
        </button>
        <div className="jenkins-detail-title">
          <strong>{selected.name}</strong>
          <span className="mono small dim">{selected.url}</span>
        </div>
        <a className="btn btn-sm btn-ghost" href={selected.url} target="_blank" rel="noreferrer">
          打开 Jenkins <Icon name="external" size={12} />
        </a>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeConnection(selected.id)}>
          移除
        </button>
      </div>
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
