import type { MysqlConnection } from "./types";

const STORAGE_KEY = "qingshan.workbench.mysql.connections";

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mysql-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadMysqlConnections(): MysqlConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [DEMO_MYSQL_CONNECTION];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [DEMO_MYSQL_CONNECTION];
    const rows = parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : id(),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "MySQL",
        host: typeof item.host === "string" && item.host.trim() ? item.host.trim() : "127.0.0.1",
        port: Number.isFinite(Number(item.port)) ? Number(item.port) : 3306,
        username: typeof item.username === "string" && item.username.trim() ? item.username.trim() : "root",
        password: typeof item.password === "string" ? item.password : "",
      }))
      .filter((item) => item.host && item.port > 0);
    return rows.length > 0 ? rows : [DEMO_MYSQL_CONNECTION];
  } catch {
    return [DEMO_MYSQL_CONNECTION];
  }
}

export function saveMysqlConnections(connections: MysqlConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    /* 忽略隐私模式下的存储失败 */
  }
}

export function createMysqlConnection(input: {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}): MysqlConnection {
  return {
    id: id(),
    name: input.name.trim() || "MySQL",
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    password: input.password,
  };
}

export const DEMO_MYSQL_CONNECTION: MysqlConnection = {
  id: "demo-mysql",
  name: "演示 MySQL",
  host: "mysql.demo.qingshan.dev",
  port: 3306,
  username: "readonly",
};
