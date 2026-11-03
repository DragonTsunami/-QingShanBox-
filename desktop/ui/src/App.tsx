import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import { setWindowTheme, systemSnapshot } from "./api";
import {
  loadRefreshInterval,
  normalizeRefreshInterval,
  saveRefreshInterval,
} from "./preferences";
import { createClient, probeAgent } from "./devops/lib/client";
import { RESOURCE_REFRESH_EVENT } from "./devops/lib/useResource";
import { ENV_LABEL, loadSettings, saveSettings } from "./devops/lib/store";
import type { PageKey, Settings, Surface } from "./devops/lib/types";
import { WorkbenchPage } from "./devops/pages/WorkbenchPage";
import { DockerPage } from "./devops/pages/DockerPage";
import { DockerfilePage } from "./devops/pages/DockerfilePage";
import { MysqlPage } from "./devops/pages/MysqlPage";
import { TerraformPage } from "./devops/pages/TerraformPage";
import { AnsiblePage } from "./devops/pages/AnsiblePage";
import { GitPage } from "./devops/pages/GitPage";
import { JenkinsPage } from "./devops/pages/JenkinsPage";
import { ObservabilityPage } from "./devops/pages/ObservabilityPage";
import { SettingsPage } from "./devops/pages/SettingsPage";

const VERSION = "0.2.0";

const PAGE_META: Record<PageKey, { title: string; subtitle: string; surface: Surface }> = {
  workbench: {
    title: "工作台",
    subtitle: "当前版本、待处理问题与下一步动作",
    surface: "monitor",
  },
  docker: { title: "Docker", subtitle: "远程容器、镜像与 Compose 项目", surface: "monitor" },
  dockerfile: {
    title: "Dockerfile",
    subtitle: "在线编辑容器配置，导出 Dockerfile 与命令",
    surface: "editor",
  },
  databases: { title: "MySQL", subtitle: "实例、慢查询与表空间", surface: "monitor" },
  terraform: { title: "Terraform", subtitle: "工作区、漂移与变更预览", surface: "monitor" },
  ansible: { title: "Ansible", subtitle: "主机清单、剧本与最近运行", surface: "monitor" },
  git: { title: "GitHub", subtitle: "连接 GitHub，查看本人或他人的仓库更新与内容", surface: "monitor" },
  jenkins: { title: "Jenkins", subtitle: "流水线、构建记录与节点", surface: "monitor" },
  observability: {
    title: "Prometheus · Grafana",
    subtitle: "抓取目标、告警规则与仪表盘",
    surface: "monitor",
  },
  settings: { title: "设置", subtitle: "数据来源、模块与端点", surface: "monitor" },
};

const PAGE_KEYS = Object.keys(PAGE_META) as PageKey[];
const SURFACE_HOME: Record<Surface, PageKey> = { monitor: "workbench", editor: "dockerfile" };

function pageFromHash(): PageKey {
  if (typeof window === "undefined") return "workbench";
  const key = window.location.hash.replace(/^#\/?/, "") as PageKey;
  return PAGE_KEYS.includes(key) ? key : "workbench";
}

function pageAllowed(page: PageKey, modules: Settings["modules"]): boolean {
  if (page === "terraform") return modules.terraform;
  if (page === "ansible") return modules.ansible;
  return true;
}

function initialDark(): boolean {
  if (typeof window === "undefined") return false;
  const override = new URLSearchParams(window.location.search).get("theme");
  if (override === "dark") return true;
  if (override === "light") return false;
  const stored = window.localStorage.getItem("qingshan.workbench.theme");
  if (stored) return stored === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export default function App() {
  const [page, setPage] = useState<PageKey>(pageFromHash);
  const [dark, setDark] = useState(initialDark);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshInterval, setRefreshInterval] = useState<number>(loadRefreshInterval);
  const [refreshing, setRefreshing] = useState(false);
  const [hostname, setHostname] = useState<string | null>(null);
  const [agentOk, setAgentOk] = useState<boolean | null>(null);
  const lastPage = useRef<Record<Surface, PageKey>>({ ...SURFACE_HOME });

  const surface = PAGE_META[page].surface;
  const env = ENV_LABEL[settings.env];

  const client = useMemo(() => createClient(settings), [settings]);

  useEffect(() => {
    if (window.location.hash !== `#/${page}`) {
      window.history.replaceState(null, "", `#/${page}`);
    }
    lastPage.current[surface] = page;
  }, [page, surface]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      window.localStorage.setItem("qingshan.workbench.theme", dark ? "dark" : "light");
    } catch {
      // 隐私模式下 localStorage 可能不可写，主题仍然对当前会话生效。
    }
    void setWindowTheme(dark).catch(() => undefined);
  }, [dark]);

  useEffect(() => {
    saveRefreshInterval(refreshInterval);
  }, [refreshInterval]);

  useEffect(() => {
    if (pageAllowed(page, settings.modules)) return;
    setPage("workbench");
  }, [page, settings.modules]);

  useEffect(() => {
    let alive = true;
    void systemSnapshot()
      .then((snapshot) => {
        if (alive) setHostname(snapshot.hostname);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (settings.mode !== "agent") {
      setAgentOk(null);
      return;
    }
    let alive = true;
    void probeAgent(settings.agentUrl)
      .then((probe) => {
        if (alive) setAgentOk(probe.ok);
      })
      .catch(() => {
        if (alive) setAgentOk(false);
      });
    return () => {
      alive = false;
    };
  }, [settings.mode, settings.agentUrl, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRefreshKey((value) => value + 1);
      window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
    }, refreshInterval * 1000);
    return () => window.clearInterval(timer);
  }, [refreshInterval]);

  const navigate = useCallback((next: PageKey) => {
    if (!pageAllowed(next, settings.modules)) return;
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [settings.modules]);

  const switchSurface = useCallback(
    (next: Surface) => {
      if (next === surface) return;
      const target = lastPage.current[next] ?? SURFACE_HOME[next];
      setPage(pageAllowed(target, settings.modules) ? target : SURFACE_HOME[next]);
    },
    [surface, settings.modules],
  );

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
    window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 600);
  }, []);

  const handleSave = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    setRefreshKey((value) => value + 1);
    window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
  }, []);

  // 页面 key 不包含 refreshKey：全局刷新只让资源重新请求，不卸载页面组件，
  // 所以当前筛选、展开项、表单草稿和滚动位置都会保留。
  const pageKey = `${page}:${settings.mode}:${settings.agentUrl}:${settings.agentToken}`;
  const shared = { client, settings, onNavigate: navigate, onSettings: handleSave };

  const content = useMemo(() => {
    switch (page) {
      case "docker":
        return <DockerPage key={pageKey} {...shared} />;
      case "dockerfile":
        return <DockerfilePage key={pageKey} {...shared} />;
      case "databases":
        return <MysqlPage key={pageKey} {...shared} />;
      case "terraform":
        return <TerraformPage key={pageKey} {...shared} />;
      case "ansible":
        return <AnsiblePage key={pageKey} {...shared} />;
      case "git":
        return <GitPage key={pageKey} {...shared} />;
      case "jenkins":
        return <JenkinsPage key={pageKey} {...shared} />;
      case "observability":
        return <ObservabilityPage key={pageKey} {...shared} />;
      case "settings":
        return <SettingsPage key={pageKey} settings={settings} onSave={handleSave} />;
      case "workbench":
      default:
        return <WorkbenchPage key={pageKey} {...shared} />;
    }
  }, [page, pageKey, shared, client, settings, handleSave]);

  const ink = dark ? "#f9fafb" : "#0f1115";
  const onInk = dark ? "#353638" : "#ffffff";
  const accent = dark ? "#7aaaff" : "#4176e6";
  const border = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: accent,
          colorInfo: accent,
          colorLink: accent,
          colorSuccess: "#22c55e",
          colorWarning: "#f59e0b",
          colorError: dark ? "#f25a5a" : "#ec1313",
          colorBgBase: dark ? "#151517" : "#ffffff",
          colorBgContainer: dark ? "#232324" : "#ffffff",
          colorBgElevated: dark ? "#2c2c2e" : "#ffffff",
          colorBgLayout: dark ? "#151517" : "#ffffff",
          colorBorder: border,
          colorBorderSecondary: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
          colorText: dark ? "#f9fafb" : "#0f1115",
          colorTextSecondary: dark ? "#cfd3d6" : "#61666b",
          colorTextTertiary: dark ? "#adb2b8" : "#81858c",
          colorTextQuaternary: dark ? "#81858c" : "#adb2b8",
          colorTextLightSolid: onInk,
          colorFillSecondary: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
          colorFillTertiary: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
          borderRadius: 10,
          borderRadiusLG: 16,
          borderRadiusSM: 8,
          controlHeight: 36,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
          boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
          boxShadowSecondary: "0 8px 24px rgba(16,24,40,0.08)",
        },
        components: {
          Button: {
            colorPrimary: ink,
            colorPrimaryHover: dark ? "#ebeef2" : "#292929",
            colorPrimaryActive: dark ? "#cfd3d6" : "#000000",
            primaryColor: onInk,
            defaultBg: dark ? "#232324" : "#f5f6f7",
            defaultBorderColor: "transparent",
            defaultColor: dark ? "#f9fafb" : "#0f1115",
            defaultHoverBg: dark ? "#2c2c2e" : "#ebeef2",
            defaultHoverBorderColor: "transparent",
            defaultHoverColor: dark ? "#f9fafb" : "#0f1115",
            fontWeight: 500,
            primaryShadow: "none",
            defaultShadow: "none",
            dangerShadow: "none",
          },
          Table: {
            headerBg: dark ? "#1b1b1c" : "#f9fafb",
            headerColor: dark ? "#adb2b8" : "#81858c",
            headerSplitColor: "transparent",
            rowHoverBg: dark ? "#2c2c2e" : "#f9fafb",
            borderColor: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
            cellPaddingBlock: 11,
          },
          Input: {
            colorBgContainer: dark ? "#232324" : "#f5f6f7",
            activeBorderColor: accent,
            hoverBorderColor: dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)",
            activeShadow: `0 0 0 3px ${accent}1f`,
          },
          Select: {
            colorBgContainer: dark ? "#232324" : "#f5f6f7",
            optionSelectedBg: dark ? "#353638" : "#ebeef2",
          },
          Segmented: {
            trackBg: dark ? "#1b1b1c" : "#f5f6f7",
            itemSelectedBg: dark ? "#353638" : "#ffffff",
            itemColor: dark ? "#adb2b8" : "#61666b",
            itemSelectedColor: dark ? "#f9fafb" : "#0f1115",
            itemHoverColor: dark ? "#f9fafb" : "#0f1115",
            trackPadding: 2,
          },
          Tag: {
            defaultBg: dark ? "#2c2c2e" : "#f5f6f7",
            defaultColor: dark ? "#cfd3d6" : "#61666b",
          },
          Modal: {
            contentBg: dark ? "#232324" : "#ffffff",
            headerBg: dark ? "#232324" : "#ffffff",
          },
          Tooltip: {
            colorBgSpotlight: dark ? "#f9fafb" : "#0f1115",
            colorTextLightSolid: dark ? "#151517" : "#ffffff",
          },
        },
      }}
    >
      <AntApp>
        <div className="app-shell">
          <Sidebar
            page={page}
            surface={surface}
            onNavigate={navigate}
            onSurfaceChange={switchSurface}
            mode={settings.mode}
            env={env}
            modules={settings.modules}
            version={VERSION}
          />
          <div className="app-main">
            <TopBar
              title={PAGE_META[page].title}
              subtitle={PAGE_META[page].subtitle}
              hostname={hostname}
              mode={settings.mode}
              agentConnected={agentOk}
              dark={dark}
              onToggleTheme={() => setDark((value) => !value)}
              refreshing={false}
              refreshInterval={refreshInterval}
              onRefreshIntervalChange={(seconds) => setRefreshInterval(normalizeRefreshInterval(seconds))}
              onRefresh={refresh}
            />
            <main className="app-content">{content}</main>
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  );
}
