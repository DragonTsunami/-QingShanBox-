import { useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Drawer, Empty, KvList, Loading, PctCell, SearchInput, Stat, Tabs } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { fixed, num, percent, relTime, size } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, Settings, SlowQuery } from "../lib/types";

export function MysqlPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.mysql(), clientSignature(settings.mode, settings.agentUrl, "mysql"));
  const [tab, setTab] = useState("slow");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SlowQuery | null>(null);

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
    </div>
  );
}
