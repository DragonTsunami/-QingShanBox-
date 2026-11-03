import type { Settings } from "./types";

const STORAGE_KEY = "qingshan.devops.settings";

export const DEFAULT_SETTINGS: Settings = {
  mode: "demo",
  agentUrl: "http://127.0.0.1:7331",
  agentToken: "",
  env: "prod",
  modules: { terraform: false, ansible: false },
  endpoints: {
    docker: "npipe://./pipe/docker_engine",
    mysql: "10.20.8.11:3306",
    terraform: "s3://qingshan-tfstate",
    ansible: "ansible/inventory/prod.ini",
    git: "D:\\work",
    jenkins: "https://ci.qingshan.dev",
    prometheus: "http://prom.qingshan.dev:9090",
    grafana: "https://grafana.qingshan.dev",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 读取设置：任何字段缺失或类型不对都回落到默认值，避免旧版本 localStorage 让页面崩掉。 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;
    const mode = parsed.mode === "agent" ? "agent" : "demo";
    const env = parsed.env === "dev" || parsed.env === "staging" ? parsed.env : "prod";
    const agentUrl = typeof parsed.agentUrl === "string" && parsed.agentUrl.trim() ? parsed.agentUrl.trim() : DEFAULT_SETTINGS.agentUrl;
    const agentToken = typeof parsed.agentToken === "string" ? parsed.agentToken.trim() : "";
    const endpoints = { ...DEFAULT_SETTINGS.endpoints };
    if (isRecord(parsed.endpoints)) {
      for (const key of Object.keys(endpoints) as Array<keyof Settings["endpoints"]>) {
        const value = parsed.endpoints[key];
        if (typeof value === "string") endpoints[key] = value;
      }
    }
    const modules = { ...DEFAULT_SETTINGS.modules };
    if (isRecord(parsed.modules)) {
      modules.terraform = parsed.modules.terraform === true;
      modules.ansible = parsed.modules.ansible === true;
    }
    return { mode, agentUrl, agentToken, env, modules, endpoints };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

export const ENV_LABEL: Record<Settings["env"], string> = {
  dev: "开发",
  staging: "预发",
  prod: "生产",
};
