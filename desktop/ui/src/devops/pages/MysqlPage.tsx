import { useMemo, useState } from "react";
import { createMysqlConnection, loadMysqlConnections, saveMysqlConnections } from "../lib/mysql-connections";
import { DeleteConnectionDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Drawer, Empty, KvList, Loading, PctCell, SearchInput, Stat, Tabs } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { fixed, num, percent, relTime, size } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, MysqlConnection, MysqlSnapshot, Settings, SlowQuery } from "../lib/types";

const EMPTY_MYSQL: MysqlSnapshot = {
  instances: [],
  slowQueries: [],
  tables: [],
};

type MysqlDraft = { name: string; host: string; port: string; username: string; password: string };

function MysqlConnectionDialog({
  open,
  draft,
  error,
  testing,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: MysqlDraft;
  error: string;
  testing: boolean;
  onChange: (draft: MysqlDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="jenkins-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="jenkins-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="jenkins-modal-head">
          <div>
            <h2>添加 MySQL 连接</h2>
            <p>填写远程 MySQL 地址与账号；连接测试成功后才保存。</p>
          </div>
          <button type="button" className="btn btn-icon btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="connection-form">
          <label className="field">
            <span className="field-label">连接名称</span>
            <input
              className="input"
              value={draft.name}
              placeholder="例如：上海只读库"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </label>
          <div className="connection-grid">
            <label className="field">
              <span className="field-label">主机</span>
              <input
                className="input"
                value={draft.host}
                placeholder="10.0.0.5"
                onChange={(event) => onChange({ ...draft, host: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">端口</span>
              <input
                className="input"
                value={draft.port}
                placeholder="3306"
                onChange={(event) => onChange({ ...draft, port: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">用户名</span>
            <input
              className="input"
              value={draft.username}
              placeholder="monitor"
              onChange={(event) => onChange({ ...draft, username: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              value={draft.password}
              placeholder="只保存在本机连接配置中"
              onChange={(event) => onChange({ ...draft, password: event.target.value })}
            />
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

export function MysqlPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const [connections, setConnections] = useState<MysqlConnection[]>(() => loadMysqlConnections());
  const [connectionId, setConnectionId] = useState("");
  const connection = connections.find((item) => item.id === connectionId) ?? null;
  const resource = useResource(
    () => (connection ? client.mysql(connection) : Promise.resolve(EMPTY_MYSQL)),
    `${clientSignature(settings.mode, settings.agentUrl, "mysql")}:${connection?.id ?? "list"}`,
  );
  const [tab, setTab] = useState("slow");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SlowQuery | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", host: "127.0.0.1", port: "3306", username: "root", password: "" });
  const [formError, setFormError] = useState("");
  const [testing, setTesting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MysqlConnection | null>(null);

  const addConnection = async () => {
    const port = Number(draft.port);
    if (!draft.name.trim()) return setFormError("连接名称不能为空");
    if (!draft.host.trim()) return setFormError("MySQL 地址不能为空");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return setFormError("端口需为 1-65535 的整数");
    if (!draft.username.trim()) return setFormError("用户名不能为空");
    const next = createMysqlConnection({ ...draft, port });
    setTesting(true);
    setFormError("");
    try {
      await client.mysql(next);
    } catch (error) {
      setFormError(`无法连接该 MySQL：${error instanceof Error ? error.message : "请检查地址与账号权限"}`);
      setTesting(false);
      return;
    }
    const all = [...connections, next];
    setConnections(all);
    saveMysqlConnections(all);
    setAddOpen(false);
    setDraft({ name: "", host: "127.0.0.1", port: "3306", username: "root", password: "" });
    setFormError("");
    setTesting(false);
  };

  const removeConnection = (target: MysqlConnection) => {
    const next = connections.filter((item) => item.id !== target.id);
    setConnections(next);
    saveMysqlConnections(next);
    if (connectionId === target.id) setConnectionId("");
    setPendingDelete(null);
  };

  const data = resource.data;
  const instances = data?.instances ?? [];
  const totalConnections = instances.reduce((sum, item) => sum + item.connections, 0);
  const totalMax = instances.reduce((sum, item) => sum + item.maxConnections, 0);
  const totalQps = instances.reduce((sum, item) => sum + item.qps, 0);
  const slowTotal = instances.reduce((sum, item) => sum + item.slowQueries, 0);
  const degraded = instances.filter((item) => item.health !== "up");

  const slowQueries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = data?.slowQueries ?? [];
    return needle ? rows.filter((row) => `${row.sql} ${row.digest}`.toLowerCase().includes(needle)) : rows;
  }, [data, query]);

  const tables = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = data?.tables ?? [];
    return needle ? rows.filter((row) => `${row.schema}.${row.table}`.toLowerCase().includes(needle)) : rows;
  }, [data, query]);

  const maxTable = Math.max(1, ...(data?.tables ?? []).map((row) => row.sizeMb));

  if (!connection) {
    return (
      <div className="page">
        <Card
          title="MySQL 连接"
          sub="像 GitHub 仓库一样逐个打开；每个连接独立保存，不使用下拉切换"
          actions={<button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>添加连接</button>}
        >
          <p className="gh-add-hint">选择一张连接卡查看实例、慢查询与表。新增连接会先执行一次真实查询，成功后才保存。</p>
        </Card>

        {connections.length === 0 ? (
          <Card>
            <Empty
              icon="database"
              title="还没有 MySQL 连接"
              hint="添加一台远程 MySQL；账号建议只授予监控所需的只读权限。"
              action={<button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>添加连接</button>}
            />
          </Card>
        ) : (
          <div className="gh-grid">
            {connections.map((item) => (
              <article key={item.id} className="gh-card">
                <button type="button" className="gh-card-main" onClick={() => setConnectionId(item.id)}>
                  <div className="gh-card-top">
                    <span className="gh-owner">MYSQL/</span>
                    <strong className="gh-card-name">{item.name}</strong>
                  </div>
                  <p className="gh-card-desc mono">{item.host}:{item.port}</p>
                  <div className="gh-card-foot">
                    <span>{item.username || "未配置用户名"}</span>
                    <span className="spacer" />
                    <span>点击打开</span>
                  </div>
                </button>
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
              </article>
            ))}
          </div>
        )}

        <MysqlConnectionDialog
          open={addOpen}
          draft={draft}
          error={formError}
          testing={testing}
          onChange={setDraft}
          onClose={() => { setAddOpen(false); setFormError(""); setTesting(false); }}
          onSubmit={addConnection}
        />
        <DeleteConnectionDialog
          open={Boolean(pendingDelete)}
          name={pendingDelete?.name ?? ""}
          kind="MySQL"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete) removeConnection(pendingDelete);
          }}
        />
      </div>
    );
  }

  if (resource.loading && !data) return <Loading label="正在读取 MySQL 指标…" />;
  if (resource.error && !data) {
    return (
      <div className="page">
        <Empty icon="alert" title="读不到 MySQL 数据" hint={resource.error} action={<button type="button" className="btn" onClick={resource.reload}>重试</button>} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="gh-detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConnectionId("")}>
          <Icon name="chevronRight" size={14} className="flip" />
          全部 MySQL
        </button>
        <div className="gh-detail-title">
          <span className="gh-owner">MYSQL/</span>
          <strong>{connection.name}</strong>
        </div>
        <div className="spacer" />
        <span className="small dim mono">{connection.host}:{connection.port}</span>
        <button type="button" className="btn btn-ghost btn-sm gh-delete-btn" onClick={() => setPendingDelete(connection)}>
          <Icon name="x" size={12} /> 删除连接
        </button>
      </div>
      {data?.note && <Banner tone="warn">{data.note}</Banner>}
      {degraded.length > 0 && (
        <Banner tone="warn">
          <strong>{degraded.map((item) => item.id).join("、")}</strong> 存在异常：
          {degraded.map((item) => `复制延迟 ${item.replicationLagSec ?? "—"} 秒 / 慢查询 ${item.slowQueries} 条`).join("；")}。阈值 60 秒。
        </Banner>
      )}

      <div className="grid cols-4">
        <Stat icon="database" label="实例" value={String(instances.length)} foot={<span>{degraded.length ? `${degraded.length} 个需关注` : "全部正常"}</span>} />
        <Stat
          icon="server"
          label="连接数"
          value={num(totalConnections)}
          foot={<span>上限 {num(totalMax)} · {Math.round(percent(totalConnections, totalMax))}%</span>}
        />
        <Stat icon="activity" label="QPS 合计" value={num(totalQps)} foot={<span>{instances.filter((item) => item.role === "replica").length} 个副本分担读流量</span>} />
        <Stat icon="clock" label="慢查询" value={num(slowTotal)} foot={<span>近 24 小时累计</span>} />
      </div>

      <div className="split">
        <Card title="实例" sub="主库与只读副本">
          <div className="list">
            {instances.map((instance) => (
              <div key={instance.id} className="list-item" style={{ cursor: "default" }}>
                <span className="list-title">
                  <span className={`dot ${instance.health === "up" ? "dot-up" : instance.health === "degraded" ? "dot-warn" : "dot-down"}`} />
                  {instance.id}
                  <Badge mono>{instance.role === "primary" ? "主库" : "副本"}</Badge>
                </span>
                <span className="list-sub mono">
                  {instance.host}:{instance.port} · v{instance.version}
                </span>
                <span className="list-sub">
                  {num(instance.qps)} QPS · 连接 {instance.connections}
                  {instance.replicationLagSec !== null ? ` · 延迟 ${instance.replicationLagSec}s` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          flush
          head={
            <Tabs
              items={[
                { key: "slow", label: "慢查询", count: data?.slowQueries.length ?? 0 },
                { key: "tables", label: "表空间", count: data?.tables.length ?? 0 },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
          actions={
            <>
              <SearchInput value={query} onChange={setQuery} placeholder={tab === "slow" ? "SQL 关键字" : "库表名"} />
              <button type="button" className="btn btn-icon btn-sm" title="刷新" onClick={resource.reload}>
                <Icon name="refresh" size={13} />
              </button>
            </>
          }
        >
          {tab === "slow" ? (
            <DataTable
              rows={slowQueries}
              rowKey={(row) => row.digest}
              onRowClick={(row) => setSelected(row)}
              selectedKey={selected?.digest ?? null}
              columns={[
                {
                  key: "sql",
                  header: "SQL",
                  render: (row) => (
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="mono truncate" style={{ maxWidth: 460, color: "var(--text)" }}>
                        {row.sql}
                      </span>
                      <span className="small dim mono">digest {row.digest}</span>
                    </div>
                  ),
                },
                { key: "avg", header: "平均耗时", align: "right", render: (row) => <span className={row.avgMs > 1000 ? "warn-text" : undefined}>{fixed(row.avgMs, 0)} ms</span> },
                { key: "count", header: "执行次数", align: "right", render: (row) => num(row.execCount) },
                { key: "rows", header: "扫描行数", align: "right", render: (row) => num(row.rowsExamined) },
                { key: "seen", header: "最近", render: (row) => <span className="small dim">{relTime(row.lastSeen)}</span> },
              ]}
              empty={<Empty icon="search" title="没有匹配的慢查询" hint="换个关键字试试" />}
            />
          ) : (
            <DataTable
              rows={tables}
              rowKey={(row) => `${row.schema}.${row.table}`}
              columns={[
                { key: "schema", header: "库", render: (row) => <span className="dim">{row.schema}</span> },
                { key: "table", header: "表", render: (row) => <span className="strong mono">{row.table}</span> },
                { key: "rows", header: "行数", align: "right", render: (row) => num(row.rows) },
                { key: "engine", header: "引擎", render: (row) => <span className="small dim">{row.engine}</span> },
                { key: "size", header: "占用", align: "right", render: (row) => <PctCell value={percent(row.sizeMb, maxTable)} text={size(row.sizeMb)} /> },
              ]}
              empty={<Empty icon="database" title="没有匹配的表" />}
            />
          )}
        </Card>
      </div>

      <Drawer open={selected !== null} title="慢查询详情" sub={selected ? `digest ${selected.digest}` : undefined} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <div className="code-line mono">{selected.sql}</div>
            <KvList
              rows={[
                { key: "平均耗时", value: `${fixed(selected.avgMs, 0)} ms` },
                { key: "执行次数", value: num(selected.execCount) },
                { key: "扫描行数", value: num(selected.rowsExamined) },
                { key: "最近出现", value: relTime(selected.lastSeen) },
                {
                  key: "建议",
                  value:
                    selected.rowsExamined > 100_000
                      ? "扫描行数远超返回行数，建议补充覆盖索引或拆分查询"
                      : selected.avgMs > 1000
                        ? "耗时偏高，检查是否命中索引以及是否存在锁等待"
                        : "指标在可接受范围，可继续观察",
                },
              ]}
            />
            <div className="row wrap">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => announceCommand(`EXPLAIN ANALYZE ${selected.sql.slice(0, 60)}`, settings.mode)}
              >
                <Icon name="activity" size={13} /> 查看执行计划
              </button>
              <button type="button" className="btn btn-sm" onClick={() => announceCommand(`SHOW PROCESSLIST`, settings.mode)}>
                <Icon name="terminal" size={13} /> 当前会话
              </button>
            </div>
          </>
        )}
      </Drawer>

      <MysqlConnectionDialog
        open={addOpen}
        draft={draft}
        error={formError}
        testing={testing}
        onChange={setDraft}
        onClose={() => { setAddOpen(false); setFormError(""); setTesting(false); }}
        onSubmit={addConnection}
      />
      <DeleteConnectionDialog
        open={Boolean(pendingDelete)}
        name={pendingDelete?.name ?? ""}
        kind="MySQL"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeConnection(pendingDelete);
        }}
      />
    </div>
  );
}
