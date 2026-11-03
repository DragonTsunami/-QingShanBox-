import { Icon, type IconName } from "./Icons";
import type { PageKey, Settings, Surface } from "../lib/types";

interface NavItem {
  key: PageKey;
  label: string;
  icon: IconName;
  /** 只在对应模块打开时出现 */
  module?: keyof Settings["modules"];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const SURFACES: { key: Surface; label: string; icon: IconName }[] = [
  { key: "monitor", label: "监控", icon: "dashboard" },
  { key: "editor", label: "编辑", icon: "terminal" },
];

const MONITOR_GROUPS: NavGroup[] = [
  { label: "总览", items: [{ key: "workbench", label: "工作台", icon: "dashboard" }] },
  {
    label: "运行环境",
    items: [
      { key: "docker", label: "Docker", icon: "box" },
      { key: "databases", label: "MySQL", icon: "database" },
      { key: "terraform", label: "Terraform", icon: "terraform", module: "terraform" },
      { key: "ansible", label: "Ansible", icon: "ansible", module: "ansible" },
    ],
  },
  {
    label: "交付与版本",
    items: [
      { key: "git", label: "Git", icon: "git" },
      { key: "jenkins", label: "Jenkins", icon: "jenkins" },
    ],
  },
  { label: "可观测性", items: [{ key: "observability", label: "Prometheus · Grafana", icon: "activity" }] },
  { label: "系统", items: [{ key: "settings", label: "设置", icon: "settings" }] },
];

const EDITOR_GROUPS: NavGroup[] = [
  { label: "容器镜像", items: [{ key: "dockerfile", label: "Dockerfile", icon: "terminal" }] },
];

export function Sidebar({
  page,
  surface,
  onNavigate,
  onSurfaceChange,
  hints,
  mode,
  env,
  modules,
}: {
  page: PageKey;
  surface: Surface;
  onNavigate: (page: PageKey) => void;
  onSurfaceChange: (surface: Surface) => void;
  hints?: Partial<Record<PageKey, string>>;
  mode: "demo" | "agent";
  env: string;
  modules: Settings["modules"];
}) {
  const groups = surface === "monitor" ? MONITOR_GROUPS : EDITOR_GROUPS;

  return (
    <nav className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0 }}>青</span>
        </div>
        <div className="brand-text">
          <div className="brand-name">青衫工作台</div>
          <div className="brand-tag">DevOps 控制台 · v0.1</div>
        </div>
      </div>

      <div className="surface-switch" role="tablist" aria-label="模块">
        {SURFACES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={surface === item.key}
            className={surface === item.key ? "surface-item active" : "surface-item"}
            title={item.label}
            onClick={() => onSurfaceChange(item.key)}
          >
            <Icon name={item.icon} size={14} />
            <span className="surface-label">{item.label}</span>
          </button>
        ))}
      </div>

      {groups.map((group) => {
        const items = group.items.filter((item) => !item.module || modules[item.module]);
        if (items.length === 0) return null;
        return (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === page ? "nav-item active" : "nav-item"}
                aria-current={item.key === page ? "page" : undefined}
                onClick={() => onNavigate(item.key)}
                title={item.label}
              >
                <span className="nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="nav-label-text">{item.label}</span>
                {hints?.[item.key] && <span className="nav-hint">{hints[item.key]}</span>}
              </button>
            ))}
          </div>
        );
      })}

      {surface === "editor" && (
        <div className="sidebar-tip">只生成文件与命令，不在本机执行 docker build / run。</div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-note">
          {mode === "demo" ? "演示数据 · 不执行" : "本地 agent · 确认后执行"} · 环境 {env}
        </div>
      </div>
    </nav>
  );
}
