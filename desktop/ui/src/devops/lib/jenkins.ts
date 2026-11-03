import type { JenkinsConnection } from "./types";

const STORAGE_KEY = "qingshan.workbench.jenkins.connections";

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `jenkins-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadJenkinsConnections(): JenkinsConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : id(),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Jenkins",
        url: typeof item.url === "string" ? normalizeUrl(item.url) : "",
        username: typeof item.username === "string" ? item.username : "",
        token: typeof item.token === "string" ? item.token : "",
      }))
      .filter((item) => item.url.startsWith("http://") || item.url.startsWith("https://"));
  } catch {
    return [];
  }
}

export function saveJenkinsConnections(connections: JenkinsConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function createJenkinsConnection(input: {
  name: string;
  url: string;
  username?: string;
  token?: string;
}): JenkinsConnection {
  return {
    id: id(),
    name: input.name.trim() || "Jenkins",
    url: normalizeUrl(input.url),
    username: input.username?.trim() ?? "",
    token: input.token?.trim() ?? "",
  };
}

export function isJenkinsUrl(value: string): boolean {
  const url = normalizeUrl(value);
  return url.startsWith("http://") || url.startsWith("https://");
}

export const DEMO_JENKINS_CONNECTION: JenkinsConnection = {
  id: "demo-jenkins",
  name: "演示 Jenkins",
  url: "https://ci.qingshan.dev",
};
