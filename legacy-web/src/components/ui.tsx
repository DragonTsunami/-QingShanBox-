import { useEffect, type ReactNode } from "react";
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
  /** 完全自定义卡片头部（例如放 Tabs），不再套 .card-title 的排版。 */
  head?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={flush ? "card flush" : "card"}>
      {(head || title || actions) && (
        <div className="card-head">
          {head ?? (
            <>
              {title && (
                <div style={{ minWidth: 0 }}>
                  <div className="card-title">{title}</div>
                  {sub && <div className="card-sub">{sub}</div>}
                </div>
              )}
              {actions && <div className="card-actions">{actions}</div>}
            </>
          )}
          {head && actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
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
    <div className="stat">
      <div className="stat-label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <small> {unit}</small>}
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

/* ---------- 状态 ---------- */

export type StatusTone = "ok" | "warn" | "err" | "idle";

const DOT_CLASS: Record<StatusTone, string> = {
  ok: "dot dot-up",
  warn: "dot dot-warn",
  err: "dot dot-down",
  idle: "dot dot-idle",
};

export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="status">
      <span className={DOT_CLASS[tone]} />
      {children}
    </span>
  );
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
  const cls = ["badge", tone !== "plain" ? `tone-${tone}` : "", mono ? "mono" : ""].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}

/* ---------- 进度条 ---------- */

export function Bar({ value, tone }: { value: number; tone?: "good" | "high" | "critical" }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="bar">
      <div className={tone ? `bar-fill ${tone}` : "bar-fill"} style={{ width: `${width}%` }} />
    </div>
  );
}

/** 百分比条 + 数值，用于连接数、内存、磁盘等占用。 */
export function PctCell({ value, text }: { value: number; text?: string }) {
  const tone = value >= 90 ? "critical" : value >= 75 ? "high" : "good";
  return (
    <div className="bar-cell">
      <Bar value={value} tone={tone} />
      <span className="bar-value">{text ?? `${Math.round(value)}%`}</span>
    </div>
  );
}

export function BuildStrip({ history }: { history: Array<"success" | "failure" | "unstable" | "running" | "never"> }) {
  return (
    <div className="build-strip" title={history.join(" · ")}>
      {history.map((item, index) => {
        const cls =
          item === "success" ? "ok" : item === "failure" ? "bad" : item === "unstable" ? "warn" : item === "running" ? "running" : "";
        return <span key={index} className={`build-block ${cls}`} style={{ height: item === "never" ? 6 : 22 }} />;
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
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={item.key === value ? "tab active" : "tab"}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {typeof item.count === "number" && <span className="dim"> {item.count}</span>}
        </button>
      ))}
    </div>
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
    <div className="segmented" role="group">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.key === value}
          className={item.key === value ? "active" : undefined}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- 输入 ---------- */

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索",
  className = "input narrow",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className="search">
      <span className="search-icon">
        <Icon name="search" size={13} />
      </span>
      <input className={className} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
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
  const fallback: IconName = tone === "error" ? "alert" : tone === "warn" ? "alert" : "info";
  return (
    <div className={tone === "info" ? "banner" : `banner ${tone}`}>
      <span className="banner-icon">
        <Icon name={icon ?? fallback} size={14} />
      </span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Empty({ icon = "info", title, hint, action }: { icon?: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={16} />
      </div>
      <div>{title}</div>
      {hint && <div className="dim small">{hint}</div>}
      {action}
    </div>
  );
}

export function Loading({ label = "正在读取数据…" }: { label?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="clock" size={16} />
      </div>
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
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align ?? undefined }}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            const className = [onRowClick ? "clickable" : "", selectedKey === key ? "selected" : ""].filter(Boolean).join(" ");
            return (
              <tr key={key} className={className || undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[column.align === "right" ? "num" : "", column.className ?? ""].filter(Boolean).join(" ") || undefined}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
    <svg className="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height }} aria-hidden="true">
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
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="card-title">{title}</div>
            {sub && <div className="card-sub mono">{sub}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

/* ---------- 键值列表 ---------- */

export function KvList({ rows }: { rows: Array<{ key: string; value: ReactNode }> }) {
  return (
    <div className="kv-list">
      {rows.map((row) => (
        <div className="kv-row" key={row.key}>
          <span className="kv-key">{row.key}</span>
          <span className="kv-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
