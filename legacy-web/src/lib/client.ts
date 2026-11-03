import * as fixtures from "../data/fixtures";
import { commandPreview } from "./actions";
import type {
  ActionOutcome,
  ActionRequest,
  AnsibleSnapshot,
  DevopsClient,
  DockerSnapshot,
  GitSnapshot,
  JenkinsSnapshot,
  MysqlSnapshot,
  ObservabilitySnapshot,
  Settings,
  SourceState,
  TerraformSnapshot,
} from "./types";

export class ClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

const clone = <T>(value: T): T => structuredClone(value);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 演示模式下让采样数字轻微漂移。否则每 10 秒取到的值一模一样，
 * 监测曲线会是一条直线，看不出这是在采样。
 */
function driftDocker(snapshot: DockerSnapshot): DockerSnapshot {
  const next = clone(snapshot);
  for (const item of next.containers) {
    if (item.state !== "running") continue;
    item.cpuPercent = Math.round(item.cpuPercent * (0.78 + Math.random() * 0.44) * 10) / 10;
    item.memMb = Math.round(item.memMb * (0.94 + Math.random() * 0.12));
    if (Math.random() < 0.05) item.restarts += 1;
  }
  return next;
}

function driftMysql(snapshot: MysqlSnapshot): MysqlSnapshot {
  const next = clone(snapshot);
  for (const item of next.instances) {
    item.qps = Math.round(item.qps * (0.88 + Math.random() * 0.24));
    item.connections = Math.max(1, Math.round(item.connections * (0.95 + Math.random() * 0.1)));
    if (Math.random() < 0.25) item.slowQueries += 1;
  }
  return next;
}

function driftJenkins(snapshot: JenkinsSnapshot): JenkinsSnapshot {
  const next = clone(snapshot);
  next.queue = Math.max(0, snapshot.queue + (Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0));
  return next;
}

/** 演示模式：数据来自 fixtures，带一点延迟让加载态可见。 */
export function createDemoClient(jenkinsUrl = ""): DevopsClient {
  const respond = async <T>(value: T): Promise<T> => {
    await wait(160 + Math.random() * 240);
    return clone(value);
  };
  const respondFresh = async <T>(value: T): Promise<T> => {
    await wait(160 + Math.random() * 240);
    return value;
  };
  return {
    mode: "demo",
    sources: () => respond<SourceState[]>(fixtures.sources),
    docker: () => respondFresh<DockerSnapshot>(driftDocker(fixtures.docker)),
    mysql: () => respondFresh<MysqlSnapshot>(driftMysql(fixtures.mysql)),
    terraform: () => respond<TerraformSnapshot>(fixtures.terraform),
    ansible: () => respond<AnsibleSnapshot>(fixtures.ansible),
    git: () => respond<GitSnapshot>(fixtures.git),
    jenkins: () => respondFresh<JenkinsSnapshot>(driftJenkins(fixtures.jenkins)),
    observability: () => respond<ObservabilitySnapshot>(fixtures.observability),
    execute: (request: ActionRequest) => simulateAction(request, jenkinsUrl),
  };
}

const SIMULATED_OUTPUT: Record<ActionRequest["action"], string> = {
  "docker.restart": "qingshan-api-1",
  "docker.start": "qingshan-api-1",
  "docker.stop": "qingshan-api-1",
  "git.fetch": "From github.com:qingshan/qingshan\n * [new tag]         v1.14.2 -> v1.14.2",
  "git.pull": "Updating 9ac83e2..3f9c2a1\nFast-forward\n 12 files changed, 240 insertions(+), 22 deletions(-)",
  "jenkins.build": "Queued build #1843 for qingshan-api",
};

/**
 * 演示模式不碰本机：只走一遍「确认 → 执行中 → 结果」的流程，
 * 返回 simulated: true，工作台会把这条记录标成「演示」。
 */
async function simulateAction(request: ActionRequest, jenkinsUrl: string): Promise<ActionOutcome> {
  const started = Date.now();
  await wait(600 + Math.random() * 500);
  return {
    action: request.action,
    command: commandPreview(request.action, request.target, jenkinsUrl),
    ok: true,
    simulated: true,
    output: SIMULATED_OUTPUT[request.action],
    error: "",
    durationMs: Date.now() - started,
    at: new Date().toISOString(),
  };
}

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: string; detail?: string };
        detail = parsed.detail ?? parsed.error ?? detail;
      } catch {
        /* 非 JSON 错误体，直接用原文 */
      }
      throw new ClientError(detail || `请求失败（HTTP ${response.status}）`, response.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ClientError("本地 agent 返回的不是合法 JSON");
    }
  } catch (error) {
    if (error instanceof ClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ClientError(`本地 agent 超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw new ClientError(`连接不上本地 agent：${url}`);
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 60_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { accept: "application/json", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { detail?: string; error?: string };
        detail = parsed.detail ?? parsed.error ?? detail;
      } catch {
        /* 非 JSON 错误体 */
      }
      throw new ClientError(detail || `执行失败（HTTP ${response.status}）`, response.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ClientError("本地 agent 返回的不是合法 JSON");
    }
  } catch (error) {
    if (error instanceof ClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ClientError(`执行超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw new ClientError(`连接不上本地 agent：${url}`);
  } finally {
    clearTimeout(timer);
  }
}

interface AgentActionResponse {
  action: ActionRequest["action"];
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  at: string;
}

/** agent 模式：所有数据由本地 Node 进程采集，前端只渲染。 */
export function createAgentClient(baseUrl: string, token = ""): DevopsClient {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    mode: "agent",
    sources: () => getJson<SourceState[]>(`${base}/api/sources`),
    docker: () => getJson<DockerSnapshot>(`${base}/api/docker`),
    mysql: () => getJson<MysqlSnapshot>(`${base}/api/mysql`),
    terraform: () => getJson<TerraformSnapshot>(`${base}/api/terraform`),
    ansible: () => getJson<AnsibleSnapshot>(`${base}/api/ansible`),
    git: () => getJson<GitSnapshot>(`${base}/api/git`),
    jenkins: () => getJson<JenkinsSnapshot>(`${base}/api/jenkins`),
    observability: () => getJson<ObservabilitySnapshot>(`${base}/api/observability`),
    async execute(request: ActionRequest): Promise<ActionOutcome> {
      if (!token.trim()) {
        throw new ClientError("没有填写执行令牌：在 agent 启动日志里找到「执行令牌」，填到设置页。");
      }
      const result = await postJson<AgentActionResponse>(
        `${base}/api/actions`,
        { action: request.action, target: request.target },
        { "x-qingshan-token": token.trim() },
      );
      return {
        action: result.action,
        command: result.command,
        ok: result.ok,
        simulated: false,
        output: result.stdout,
        error: result.stderr,
        durationMs: result.durationMs,
        at: result.at,
      };
    },
  };
}

export function createClient(settings: Settings): DevopsClient {
  return settings.mode === "agent"
    ? createAgentClient(settings.agentUrl, settings.agentToken)
    : createDemoClient(settings.endpoints.jenkins);
}

export interface AgentProbe {
  ok: boolean;
  detail: string;
  version?: string;
  platform?: string;
}

/** 探测本地 agent 是否可用（设置页用）。 */
export async function probeAgent(baseUrl: string): Promise<AgentProbe> {
  try {
    const info = await getJson<{ name?: string; version?: string; platform?: string }>(
      `${baseUrl.replace(/\/+$/, "")}/api/health`,
      4000,
    );
    return { ok: true, detail: info.name ?? "agent 已就绪", version: info.version, platform: info.platform };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** 页面里统一的错误文案。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || "未知错误";
  if (typeof error === "string" && error.trim()) return error;
  return "未知错误";
}
