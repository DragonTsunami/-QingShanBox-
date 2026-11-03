import type { ReactNode } from "react";
import {
  Alert,
  Badge as AntBadge,
  Card as AntCard,
  Descriptions,
  Drawer as AntDrawer,
  Empty as AntEmpty,
  Input,
  Progress,
  Segmented as AntSegmented,
  Spin,
  Table,
  Tabs as AntTabs,
  Tag,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { Icon, type IconName } from "./Icons";

/* ---------- 卡片 ---------- */

export function Card({
  title,
  sub,
  actions,
  head,
  flush,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** 完全自定义卡片头部（例如放 Tabs），不再套标题排版。 */
  head?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
}) {
  const heading = head ?? (
    <div className="wb-card-title">
      <div className="wb-card-name">{title}</div>
      {sub && <div className="wb-card-sub">{sub}</div>}
    </div>
  );

  return (
    <AntCard
      className="wb-card"
      size="small"
      title={head ? head : title || actions ? heading : undefined}
      extra={actions}
      styles={{ body: { padding: flush ? 0 : "14px 16px 16px" } }}
    >
      {children}
    </AntCard>
  );
}

/* ---------- 指标 ---------- */

export function Stat({
  label,
  value,
  unit,
  foot,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="wb-stat">
      <div className="wb-stat-label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="wb-stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="wb-stat-foot">{foot}</div>}
    </div>
  );
}

/* ---------- 状态 ---------- */

export type StatusTone = "ok" | "warn" | "err" | "idle";

const BADGE_STATUS: Record<StatusTone, "success" | "warning" | "error" | "default"> = {
  ok: "success",
  warn: "warning",
  err: "error",
  idle: "default",
};

export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <AntBadge status={BADGE_STATUS[tone]} text={children} className="wb-status" />;
}

export function Badge({
  tone = "plain",
  mono,
  children,
}: {
  tone?: "ok" | "warn" | "err" | "info" | "plain";
  mono?: boolean;
  children: ReactNode;
}) {
  const color = tone === "plain" ? undefined : tone === "ok" ? "green" : tone === "warn" ? "orange" : tone === "err" ? "red" : "blue";
  return (
    <Tag bordered={false} color={color} className={mono ? "wb-tag mono" : "wb-tag"}>
      {children}
    </Tag>
  );
}

/* ---------- 进度条 ---------- */

const BAR_COLOR = {
  good: "#22c55e",
  high: "#f59e0b",
  critical: "#ec1313",
} as const;

export function Bar({ value, tone }: { value: number; tone?: "good" | "high" | "critical" }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <Progress
      percent={percent}
      showInfo={false}
      size={["100%", 6]}
      strokeColor={tone ? BAR_COLOR[tone] : undefined}
      trailColor="rgba(127,127,127,0.18)"
      className="wb-bar"
    />
  );
}

/** 百分比条 + 数值，用于连接数、内存、磁盘等占用。 */
export function PctCell({ value, text }: { value: number; text?: string }) {
  const tone = value >= 90 ? "critical" : value >= 75 ? "high" : "good";
  return (
    <div className="wb-bar-cell">
      <Bar value={value} tone={tone} />
      <span className="wb-bar-value">{text ?? `${Math.round(value)}%`}</span>
    </div>
  );
}

export function BuildStrip({ history }: { history: Array<"success" | "failure" | "unstable" | "running" | "never"> }) {
  return (
    <div className="wb-build-strip" title={history.join(" · ")}>
      {history.map((item, index) => {
        const cls =
          item === "success" ? "ok" : item === "failure" ? "bad" : item === "unstable" ? "warn" : item === "running" ? "running" : "";
        return <span key={index} className={`wb-build-block ${cls}`} style={{ height: item === "never" ? 6 : 22 }} />;
      })}
    </div>
  );
}

/* ---------- 标签页 ---------- */

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (key: string) => void }) {
  return (
    <AntTabs
      size="small"
      activeKey={value}
      onChange={onChange}
      className="wb-tabs"
      items={items.map((item) => ({
        key: item.key,
        label: (
          <span>
            {item.label}
            {typeof item.count === "number" && <span className="wb-tab-count">{item.count}</span>}
          </span>
        ),
      }))}
    />
  );
}

export function Segmented({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <AntSegmented
      size="small"
      value={value}
      onChange={(next) => onChange(String(next))}
      options={items.map((item) => ({ value: item.key, label: item.label }))}
    />
  );
}

/* ---------- 输入 ---------- */

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      allowClear
      className={className ?? "wb-search"}
      value={value}
      placeholder={placeholder}
      prefix={<SearchOutlined />}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="wb-field">
      <span className="wb-field-label">{label}</span>
      {children}
      {hint && <span className="wb-field-hint">{hint}</span>}
    </label>
  );
}

/* ---------- 提示块 ---------- */

export function Banner({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "warn" | "error";
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <Alert
      className="wb-banner"
      type={tone === "info" ? "info" : tone === "warn" ? "warning" : "error"}
      showIcon
      message={<span>{children}</span>}
      icon={icon ? <Icon name={icon} size={14} /> : undefined}
    />
  );
}

export function Empty({ icon = "info", title, hint, action }: { icon?: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="wb-empty">
      <Icon name={icon} size={18} />
      <div>{title}</div>
      {hint && <div className="dim small">{hint}</div>}
      {action}
    </div>
  );
}

export function Loading({ label = "正在读取数据…" }: { label?: string }) {
  return (
    <div className="wb-empty">
      <Spin size="small" />
      <div>{label}</div>
    </div>
  );
}

/* ---------- 表格 ---------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: "left" | "right";
  width?: number | string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return <>{empty ?? <Empty icon="search" title="没有匹配的记录" hint="调整筛选条件后重试" />}</>;
  }

  return (
    <Table<T>
      className="wb-table"
      size="small"
      bordered={false}
      pagination={false}
      rowKey={(row, index) => rowKey(row, index ?? 0)}
      dataSource={rows}
      columns={columns.map((column) => ({
        key: column.key,
        title: column.header,
        align: column.align,
        width: column.width,
        className: column.className,
        render: (_value: unknown, row: T, index: number) => column.render(row, index),
      }))}
      onRow={(row) => ({
        onClick: onRowClick ? () => onRowClick(row) : undefined,
        className: onRowClick ? "wb-row-click" : undefined,
      })}
      rowClassName={(row, index) => (selectedKey && rowKey(row, index ?? 0) === selectedKey ? "wb-row-selected" : "")}
    />
  );
}

/* ---------- 图表 ---------- */

export function Sparkline({ points, height = 56 }: { points: number[]; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const coords = points.map((point, index) => {
    // 常数序列画在中线，避免贴着底边看不出是一条线
    const y = max === min ? 15 : 26 - ((point - min) / span) * 24;
    return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(" ");
  return (
    <svg className="wb-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <polygon points={`0,30 ${line} 100,30`} fill="var(--accent-soft)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ---------- 抽屉 ---------- */

export function Drawer({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnClose
      title={
        <div className="wb-drawer-title">
          <div className="wb-card-name">{title}</div>
          {sub && <div className="wb-card-sub mono">{sub}</div>}
        </div>
      }
    >
      {children}
    </AntDrawer>
  );
}

/* ---------- 键值列表 ---------- */

export function KvList({ rows }: { rows: Array<{ key: string; value: ReactNode }> }) {
  return (
    <Descriptions
      className="wb-kv"
      column={1}
      size="small"
      colon={false}
      items={rows.map((row) => ({
        key: row.key,
        label: <span className="wb-kv-key">{row.key}</span>,
        children: <span className="wb-kv-value">{row.value}</span>,
      }))}
    />
  );
}
