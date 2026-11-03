import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Toaster, showToast } from "./components/toast";
import { AnsiblePage } from "./pages/AnsiblePage";
import { DockerPage } from "./pages/DockerPage";
import { DockerfilePage } from "./pages/DockerfilePage";
import { GitPage } from "./pages/GitPage";
import { JenkinsPage } from "./pages/JenkinsPage";
import { MysqlPage } from "./pages/MysqlPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TerraformPage } from "./pages/TerraformPage";
import { createClient } from "./lib/client";
import { ENV_LABEL, loadSettings, saveSettings } from "./lib/store";
import type { PageKey, Settings, Surface } from "./lib/types";

const PAGE_META: Record<PageKey, { title: string; subtitle: string; surface: Surface }> = {
  workbench: { title: "工作台", subtitle: "当前版本、待处理问题与下一步动作", surface: "monitor" },
  docker: { title: "Docker", subtitle: "本地容器、镜像与 compose 项目", surface: "monitor" },
  dockerfile: { title: "Dockerfile", subtitle: "在线编辑容器配置，导出 Dockerfile 与命令", surface: "editor" },
  databases: { title: "MySQL", subtitle: "实例状态、慢查询与表空间", surface: "monitor" },
  terraform: { title: "Terraform", subtitle: "工作区状态、配置漂移与变更预览", surface: "monitor" },
  ansible: { title: "Ansible", subtitle: "主机清单、剧本与最近一次运行", surface: "monitor" },
  git: { title: "Git", subtitle: "仓库工作区状态、提交与分支", surface: "monitor" },
  jenkins: { title: "Jenkins", subtitle: "流水线、构建记录与执行节点", surface: "monitor" },
  observability: { title: "可观测性", subtitle: "Prometheus 告警、抓取目标与 Grafana 仪表盘", surface: "monitor" },
  settings: { title: "设置", subtitle: "数据来源、环境与端点", surface: "monitor" },
};

const PAGE_KEYS = Object.keys(PAGE_META) as PageKey[];

/** 切换模块时回到该模块上次看的页面，第一次进入用这里的默认页。 */
const SURFACE_HOME: Record<Surface, PageKey> = { monitor: "workbench", editor: "dockerfile" };

/** 模块被关掉时，对应的页面视为不存在，直接回落到工作台。 */
function pageAllowed(page: PageKey, modules: Settings["modules"]): boolean {
  if (page === "terraform") return modules.terraform;
  if (page === "ansible") return modules.ansible;
  return true;
}

function readPage(): PageKey {
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  return (PAGE_KEYS as string[]).includes(raw) ? (raw as PageKey) : "workbench";
}

type Theme = "light" | "dark";

function readTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [page, setPage] = useState<PageKey>(readPage);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastPage = useRef<Record<Surface, PageKey>>({ ...SURFACE_HOME });
  const surface = PAGE_META[page].surface;

  const client = useMemo(() => createClient(settings), [settings.mode, settings.agentUrl, settings.agentToken]);

  useEffect(() => {
    lastPage.current[PAGE_META[page].surface] = page;
  }, [page]);

  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("qingshan.devops.theme", theme);
    } catch {
      /* 无痕模式下忽略 */
    }
  }, [theme]);

  const navigate = useCallback((next: PageKey) => {
    window.location.hash = `#/${next}`;
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const switchSurface = useCallback(
    (next: Surface) => {
      navigate(lastPage.current[next] ?? SURFACE_HOME[next]);
    },
    [navigate],
  );

  useEffect(() => {
    if (!pageAllowed(page, settings.modules)) navigate("workbench");
  }, [navigate, page, settings.modules]);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
    showToast("已重新读取数据");
  }, []);

  const handleSave = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    setRefreshKey((value) => value + 1);
  }, []);

  const meta = PAGE_META[page];
  const key = `${page}:${refreshKey}:${settings.mode}:${settings.agentUrl}:${settings.agentToken}`;
  const shared = { client, settings, onNavigate: navigate };

  return (
    <div className="app">
      <Sidebar
        page={page}
        surface={surface}
        onNavigate={navigate}
        onSurfaceChange={switchSurface}
        mode={settings.mode}
        env={ENV_LABEL[settings.env]}
        modules={settings.modules}
      />

      <div className="main">
        <TopBar
          title={meta.title}
          subtitle={meta.subtitle}
          actions={
            <>
              <span className="badge plain mono">{ENV_LABEL[settings.env]}</span>
              <span className={settings.mode === "demo" ? "badge tone-warn" : "badge tone-ok"}>
                {settings.mode === "demo" ? "演示数据" : "本地 agent"}
              </span>
              <button
                type="button"
                className="btn btn-icon"
                title={theme === "light" ? "切换到深色" : "切换到浅色"}
                aria-label="切换主题"
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                <Icon name={theme === "light" ? "moon" : "sun"} size={15} />
              </button>
              <button type="button" className="btn btn-icon" title="重新读取数据" aria-label="刷新" onClick={refresh}>
                <Icon name="refresh" size={15} />
              </button>
            </>
          }
        />

        <main className="content">
          {page === "workbench" && <WorkbenchPage key={key} {...shared} />}
          {page === "docker" && <DockerPage key={key} {...shared} />}
          {page === "dockerfile" && <DockerfilePage key={key} {...shared} />}
          {page === "databases" && <MysqlPage key={key} {...shared} />}
          {page === "terraform" && <TerraformPage key={key} {...shared} />}
          {page === "ansible" && <AnsiblePage key={key} {...shared} />}
          {page === "git" && <GitPage key={key} {...shared} />}
          {page === "jenkins" && <JenkinsPage key={key} {...shared} />}
          {page === "observability" && <ObservabilityPage key={key} {...shared} />}
          {page === "settings" && <SettingsPage key={key} settings={settings} onSave={handleSave} />}
        </main>
      </div>

      <Toaster />
    </div>
  );
}
