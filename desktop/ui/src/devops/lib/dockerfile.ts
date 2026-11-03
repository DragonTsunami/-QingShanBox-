import type { DockerContainer } from "./types";

/** Dockerfile 编辑器的数据结构：表单里的每一项都直接对应一行指令。 */
export interface EnvPair {
  key: string;
  value: string;
}

export interface CopyRule {
  from: string;
  to: string;
}

export interface DockerfileDraft {
  id: string;
  name: string;
  baseImage: string;
  workdir: string;
  args: EnvPair[];
  env: EnvPair[];
  copy: CopyRule[];
  run: string[];
  ports: string[];
  volumes: string[];
  user: string;
  healthcheck: string;
  labels: EnvPair[];
  entrypoint: string;
  cmd: string;
  extra: string;
  updatedAt: number;
}

export type DockerfileTarget = "dockerfile" | "build" | "run" | "compose";

export const TARGET_LABEL: Record<DockerfileTarget, string> = {
  dockerfile: "Dockerfile",
  build: "构建命令",
  run: "运行命令",
  compose: "compose 片段",
};

function newId(): string {
  return `df-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function newDraft(name = "qingshan-api"): DockerfileDraft {
  return {
    id: newId(),
    name,
    baseImage: "node:22-alpine",
    workdir: "/app",
    args: [],
    env: [{ key: "NODE_ENV", value: "production" }],
    copy: [{ from: "package*.json", to: "./" }],
    run: ["npm ci --omit=dev"],
    ports: ["8080"],
    volumes: [],
    user: "node",
    healthcheck: "curl -fsS http://127.0.0.1:8080/healthz",
    labels: [],
    entrypoint: "",
    cmd: "node dist/server.js",
    extra: "",
    updatedAt: Date.now(),
  };
}

export function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "app";
}

export function tagFor(draft: DockerfileDraft): string {
  return `${slug(draft.name)}:latest`;
}

/** 把 "node dist/server.js" 这类命令行切成参数；已经是 JSON 数组的原样解析。 */
export function parseCommand(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      /* 交给下面的分词 */
    }
  }
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function jsonForm(input: string): string {
  const tokens = parseCommand(input);
  if (tokens.length === 0) return "[]";
  return `[${tokens.map((token) => JSON.stringify(token)).join(", ")}]`;
}

function envValue(value: string): string {
  if (!value) return '""';
  return /[\s"'\\$#]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

function containerPort(entry: string): string {
  const arrow = entry.includes("→") ? "→" : "->";
  const right = entry.includes(arrow) ? entry.split(arrow).pop() ?? entry : entry;
  return right.replace(/\/(tcp|udp)$/i, "").trim();
}

export function renderDockerfile(draft: DockerfileDraft): string {
  const lines: string[] = ["# syntax=docker/dockerfile:1", "# 由青衫工作台生成"];

  for (const arg of draft.args) {
    if (!arg.key.trim()) continue;
    lines.push(`ARG ${arg.key.trim()}${arg.value ? `=${arg.value}` : ""}`);
  }

  lines.push(`FROM ${draft.baseImage.trim() || "<base-image>"}`);

  for (const item of draft.env) {
    if (!item.key.trim()) continue;
    lines.push(`ENV ${item.key.trim()}=${envValue(item.value)}`);
  }

  if (draft.workdir.trim()) lines.push(`WORKDIR ${draft.workdir.trim()}`);

  for (const rule of draft.copy) {
    if (!rule.from.trim()) continue;
    const to = rule.to.trim() || "./";
    lines.push(`COPY ${rule.from.trim()} ${to}`);
  }

  const runLines = draft.run.map((line) => line.trim()).filter(Boolean);
  if (runLines.length === 1) {
    lines.push(`RUN ${runLines[0]}`);
  } else if (runLines.length > 1) {
    lines.push(`RUN ${runLines[0]} \\`);
    runLines.slice(1).forEach((line, index) => {
      const tail = index === runLines.length - 2 ? "" : " \\";
      lines.push(` && ${line}${tail}`);
    });
  }

  const ports = Array.from(new Set(draft.ports.map((port) => port.trim()).filter(Boolean)));
  if (ports.length > 0) lines.push(`EXPOSE ${ports.join(" ")}`);

  const volumes = draft.volumes.map((volume) => volume.trim()).filter(Boolean);
  if (volumes.length > 0) lines.push(`VOLUME [${volumes.map((volume) => JSON.stringify(volume)).join(", ")}]`);

  if (draft.user.trim()) lines.push(`USER ${draft.user.trim()}`);

  const health = draft.healthcheck.trim();
  if (health) {
    if (/^healthcheck\b/i.test(health)) {
      lines.push(health);
    } else {
      lines.push(`HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ${jsonForm(health)}`);
    }
  }

  for (const label of draft.labels) {
    if (!label.key.trim()) continue;
    lines.push(`LABEL ${label.key.trim()}=${envValue(label.value)}`);
  }

  if (draft.entrypoint.trim()) lines.push(`ENTRYPOINT ${jsonForm(draft.entrypoint)}`);
  if (draft.cmd.trim()) lines.push(`CMD ${jsonForm(draft.cmd)}`);

  const extra = draft.extra
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  lines.push(...extra);

  return `${lines.join("\n")}\n`;
}

export function renderBuildCommand(draft: DockerfileDraft, tag = tagFor(draft)): string {
  const parts = ["docker build", `-t ${tag}`];
  for (const arg of draft.args) {
    if (!arg.key.trim()) continue;
    parts.push(`--build-arg ${arg.key.trim()}${arg.value ? `=${arg.value}` : ""}`);
  }
  parts.push(".");
  return parts.join(" ");
}

export function renderRunCommand(draft: DockerfileDraft, tag = tagFor(draft)): string {
  const parts = ["docker run", "-d", `--name ${slug(draft.name)}`];
  for (const port of draft.ports.map((item) => item.trim()).filter(Boolean)) {
    parts.push(`-p ${port.includes(":") ? port : `${port}:${port}`}`);
  }
  for (const volume of draft.volumes.map((item) => item.trim()).filter(Boolean)) {
    parts.push(`-v ${volume.includes(":") ? volume : `${volume}:${volume}`}`);
  }
  for (const item of draft.env) {
    if (!item.key.trim()) continue;
    parts.push(`-e ${item.key.trim()}=${envValue(item.value)}`);
  }
  parts.push("--restart unless-stopped", tag);
  return parts.join(" ");
}

export function renderCompose(draft: DockerfileDraft, tag = tagFor(draft)): string {
  const service = slug(draft.name);
  const lines: string[] = ["services:", `  ${service}:`, "    build:", "      context: .", "      dockerfile: Dockerfile"];
  const args = draft.args.filter((item) => item.key.trim());
  if (args.length > 0) {
    lines.push("      args:");
    for (const arg of args) lines.push(`        ${arg.key.trim()}: ${JSON.stringify(arg.value)}`);
  }
  lines.push(`    image: ${tag}`, `    container_name: ${slug(draft.name)}`);
  const ports = draft.ports.map((item) => item.trim()).filter(Boolean);
  if (ports.length > 0) {
    lines.push("    ports:");
    for (const port of ports) lines.push(`      - "${port.includes(":") ? port : `${port}:${port}`}"`);
  }
  const env = draft.env.filter((item) => item.key.trim());
  if (env.length > 0) {
    lines.push("    environment:");
    for (const item of env) lines.push(`      ${item.key.trim()}: ${JSON.stringify(item.value)}`);
  }
  const volumes = draft.volumes.map((item) => item.trim()).filter(Boolean);
  if (volumes.length > 0) {
    lines.push("    volumes:");
    for (const volume of volumes) lines.push(`      - "${volume.includes(":") ? volume : `${volume}:${volume}`}"`);
  }
  lines.push("    restart: unless-stopped");
  return `${lines.join("\n")}\n`;
}

export function renderTarget(draft: DockerfileDraft, target: DockerfileTarget): string {
  if (target === "build") return `${renderBuildCommand(draft)}\n`;
  if (target === "run") return `${renderRunCommand(draft)}\n`;
  if (target === "compose") return renderCompose(draft);
  return renderDockerfile(draft);
}

/** 表单完整性提示：不阻止导出，只提醒哪些行会让镜像跑不起来。 */
export function draftWarnings(draft: DockerfileDraft): string[] {
  const warnings: string[] = [];
  if (!draft.baseImage.trim()) warnings.push("缺少基础镜像，第一行 FROM 必须先填。");
  if (!draft.cmd.trim() && !draft.entrypoint.trim()) warnings.push("没有 CMD / ENTRYPOINT，容器启动后会立刻退出。");
  if (draft.ports.length === 0) warnings.push("没有暴露端口；如果服务只在内网被调用可以忽略。");
  if (draft.run.length === 0 && draft.copy.length === 0) warnings.push("没有任何构建步骤，镜像内容和基础镜像完全一样。");
  return warnings;
}

/** 从运行中的容器反推一份草稿：只还原能确定的字段，其余留空而不是猜。 */
export function importFromContainer(container: DockerContainer): DockerfileDraft {
  const draft = newDraft(container.name);
  draft.id = newId();
  draft.baseImage = container.image;
  draft.cmd = container.command ?? "";
  draft.ports = container.ports.map(containerPort).filter((port) => /^\d+(\/tcp|\/udp)?$/.test(port));
  draft.volumes = [];
  draft.env = [];
  draft.copy = [];
  draft.run = [];
  draft.workdir = "";
  draft.healthcheck = "";
  draft.user = "";
  draft.entrypoint = "";
  draft.labels = container.compose ? [{ key: "com.docker.compose.project", value: container.compose }] : [];
  draft.extra = "";
  draft.updatedAt = Date.now();
  return draft;
}

const DRAFT_KEY = "qingshan.devops.dockerfile.drafts";

export function loadDrafts(): DockerfileDraft[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DockerfileDraft => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.name === "string" && typeof record.baseImage === "string";
    });
  } catch {
    return [];
  }
}

export function saveDrafts(drafts: DockerfileDraft[]): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}
