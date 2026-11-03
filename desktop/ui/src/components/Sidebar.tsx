import {
  AppstoreOutlined,
  BranchesOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  EditOutlined,
  FileTextOutlined,
  FundViewOutlined,
  LineChartOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Tooltip } from "antd";
import appIcon from "../assets/app-icon.png";
import type { PageKey, Surface } from "../devops/lib/types";

interface NavItem {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  hint: string;
  /** 需要模块开关打开才显示（Terraform / Ansible）。 */
  module?: "terraform" | "ansible";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const MONITOR_GROUPS: NavGroup[] = [
  {
    label: "总览",
    items: [{ key: "workbench", label: "工作台", icon: <DashboardOutlined />, hint: "版本、待处理与下一步" }],
  },
  {
    label: "运行环境",
    items: [
      { key: "docker", label: "Docker", icon: <AppstoreOutlined />, hint: "容器、镜像与 compose" },
      { key: "databases", label: "MySQL", icon: <DatabaseOutlined />, hint: "实例、慢查询与表空间" },
      { key: "terraform", label: "Terraform", icon: <ClusterOutlined />, hint: "工作区与漂移", module: "terraform" },
      { key: "ansible", label: "Ansible", icon: <DeploymentUnitOutlined />, hint: "主机与剧本", module: "ansible" },
    ],
  },
  {
    label: "交付与版本",
    items: [
      { key: "git", label: "GitHub", icon: <BranchesOutlined />, hint: "GitHub 仓库与提交" },
      { key: "jenkins", label: "Jenkins", icon: <ThunderboltOutlined />, hint: "流水线与构建" },
    ],
  },
  {
    label: "可观测性",
    items: [
      { key: "observability", label: "Prometheus · Grafana", icon: <LineChartOutlined />, hint: "抓取目标、告警与面板" },
    ],
  },
  {
    label: "系统",
    items: [{ key: "settings", label: "设置", icon: <SettingOutlined />, hint: "数据来源、模块与端点" }],
  },
];

const EDITOR_GROUPS: NavGroup[] = [
  {
    label: "容器镜像",
    items: [{ key: "dockerfile", label: "Dockerfile", icon: <FileTextOutlined />, hint: "在线编辑并导出构建产物" }],
  },
];

export default function Sidebar({
  page,
  surface,
  onNavigate,
  onSurfaceChange,
  mode,
  env,
  modules,
  version,
}: {
  page: PageKey;
  surface: Surface;
  onNavigate: (page: PageKey) => void;
  onSurfaceChange: (surface: Surface) => void;
  mode: "demo" | "agent";
  env: string;
  modules: { terraform: boolean; ansible: boolean };
  version: string;
}) {
  const groups = surface === "monitor" ? MONITOR_GROUPS : EDITOR_GROUPS;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src={appIcon} alt="青衫工作台图标" />
        </div>
        <div className="brand-text">
          <span className="brand-name">青衫工作台</span>
          <span className="brand-caption">QINGSHAN WORKBENCH</span>
        </div>
      </div>

      <div className="surface-switch" role="tablist" aria-label="模块">
        {(
          [
            { key: "monitor", label: "监控", icon: <FundViewOutlined /> },
            { key: "editor", label: "编辑", icon: <EditOutlined /> },
          ] as Array<{ key: Surface; label: string; icon: React.ReactNode }>
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={surface === item.key}
            className={surface === item.key ? "surface-item active" : "surface-item"}
            onClick={() => onSurfaceChange(item.key)}
          >
            {item.icon}
            <span className="surface-label">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-groups">
        {groups.map((group) => {
          const items = group.items.filter((item) => !item.module || modules[item.module]);
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="nav-group">
              <div className="nav-section-label">{group.label}</div>
              <nav className="nav">
                {items.map((item) => (
                  <Tooltip key={item.key} title={item.hint} placement="right" mouseEnterDelay={0.5}>
                    <button
                      type="button"
                      className={`nav-item${page === item.key ? " active" : ""}`}
                      onClick={() => onNavigate(item.key)}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </button>
                  </Tooltip>
                ))}
              </nav>
            </div>
          );
        })}
      </div>

      <div className="sidebar-spacer" />

      {surface === "editor" && (
        <div className="sidebar-tip">
          编辑模块只生成产物：Dockerfile、构建与运行命令、compose 片段。不会在本机执行构建。
        </div>
      )}

      <div className="sidebar-footer">
        <span>v{version}</span>
        <span className="footer-dot" />
        <span>{mode === "demo" ? "演示数据" : "本地 agent"}</span>
        <span className="footer-dot" />
        <span>{env}</span>
      </div>
    </aside>
  );
}
