import type { DockerConnection } from "./types";

const STORAGE_KEY = "qingshan.workbench.docker.connections";

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `docker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadDockerConnections(): DockerConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [DEFAULT_DOCKER_CONNECTION];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [DEFAULT_DOCKER_CONNECTION];
    const rows = parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : id(),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Docker",
        host: typeof item.host === "string" ? item.host.trim() : "",
      }));
    // 只保留本机默认连接和显式填写了地址的远程连接，避免历史空地址条目静默连到本机。
    const usable = rows.filter((row) => row.id === DEFAULT_DOCKER_CONNECTION.id || row.host.trim());
    return usable.length > 0 ? usable : [DEFAULT_DOCKER_CONNECTION];
  } catch {
    return [DEFAULT_DOCKER_CONNECTION];
  }
}

export function saveDockerConnections(connections: DockerConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    /* 忽略隐私模式下的存储失败 */
  }
}

export function createDockerConnection(input: { name: string; host: string }): DockerConnection {
  return {
    id: id(),
    name: input.name.trim() || "Docker",
    host: input.host.trim(),
  };
}

export function isDockerHost(value: string): boolean {
  const host = value.trim();
  return /^(tcp|ssh|npipe|unix):\/\//.test(host);
}

export const DEFAULT_DOCKER_CONNECTION: DockerConnection = {
  id: "local-docker",
  name: "本机 Docker",
  host: "",
};
