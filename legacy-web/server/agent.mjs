#!/usr/bin/env node
/**
 * 青衫 DevOps 本地采集 agent
 *
 * 读取本机状态，并执行前端工作台里那几个固定白名单动作（重启容器 / 拉取仓库 / 触发构建）。
 * 白名单之外不接收命令行；每次执行都写一行审计记录到本机临时目录。
 *
 * 用法：node server/agent.mjs
 * 环境变量：
 *   QS_AGENT_PORT      监听端口，默认 7331（只绑定 127.0.0.1）
 *   QS_AGENT_TOKEN     执行令牌，默认启动时随机生成并打印
 *   QS_GIT_REPOS       额外的仓库根目录，用系统路径分隔符分隔（Windows 为 ;）
 *   QS_PROMETHEUS_URL  可选的 Prometheus 地址，配置后读取 targets / alerts
 *   QS_GRAFANA_URL     可选的 Grafana 地址
 *   QS_GRAFANA_TOKEN   可选的 Grafana token，用于列出仪表盘
 *   QS_JENKINS_URL     可选的 Jenkins Base URL，配置后允许触发构建
 *   QS_JENKINS_USER    可选的 Jenkins 用户名
 *   QS_JENKINS_TOKEN   可选的 Jenkins API token
 */

import http from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const VERSION = "0.1.0";
const PORT = Number(process.env.QS_AGENT_PORT ?? 7331);
const HOST = "127.0.0.1";
const startedAt = Date.now();
const AGENT_TOKEN = (process.env.QS_AGENT_TOKEN ?? "").trim() || crypto.randomBytes(12).toString("hex");
const AUDIT_FILE = path.join(os.tmpdir(), "qingshan-devops-actions.jsonl");

/* ---------------- 基础工具 ---------------- */

function run(command, args, options = {}) {
  const { timeout = 8000, cwd } = options;
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout, cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          error: error ? String(error.message ?? error) : "",
        });
      },
    );
  });
}

function hasCommand(name) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate)) return true;
      } catch {
        /* 无权限的目录跳过 */
      }
    }
    const plain = path.join(dir, name);
    try {
      if (fs.existsSync(plain)) return true;
    } catch {
      /* 忽略 */
    }
  }
  return false;
}

function parseJsonLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object") out.push(value);
    } catch {
      /* docker 有时会混入构建输出，忽略无法解析的行 */
    }
  }
  return out;
}

function sizeToMb(text) {
  const match = /([\d.]+)\s*([KMGTP]?)B/i.exec(String(text ?? ""));
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  const factor = { "": 1 / (1024 * 1024), K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024, P: 1024 ** 3 }[unit] ?? 1;
  return Math.round(value * factor * 10) / 10;
}

function dockerDate(text) {
  if (!text) return new Date().toISOString();
  const cleaned = String(text).replace(/\s+[A-Z]{2,5}$/, "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(cleaned);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function portList(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(text).split(", ")) {
    const clean = raw
      .replace(/^(?:0\.0\.0\.0:|\[::\]:|:::)/, "")
      .replace(/^:/, "")
      .trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function firstLine(text, max = 160) {
  const line = String(text ?? "").split(/\r?\n/).find((item) => item.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/* ---------------- 简单缓存，避免连续刷新时反复调用外部命令 ---------------- */

const cache = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { at: now, value });
  return value;
}

/* ---------------- Docker ---------------- */

function normalizeState(state) {
  const value = String(state ?? "").toLowerCase();
  if (value === "paused" || value === "restarting" || value === "exited" || value === "running") return value;
  if (value === "created" || value === "dead") return "exited";
  return "exited";
}

function containerHealth(status) {
  const text = String(status ?? "").toLowerCase();
  if (text.includes("(healthy)")) return "healthy";
  if (text.includes("(unhealthy)")) return "unhealthy";
  return "none";
}

async function dockerSnapshot() {
  if (!hasCommand("docker")) {
    return {
      containers: [],
      images: [],
      projects: [],
      note: "未在 PATH 中找到 docker 命令。安装 Docker Desktop 后重启 agent。",
    };
  }

  const probe = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 6000 });
  if (!probe.ok) {
    const raw = firstLine(probe.stderr || probe.error);
    const pipeIssue = /npipe|pipe\/|dockerDesktopLinuxEngine/i.test(raw);
    return {
      containers: [],
      images: [],
      projects: [],
      note: pipeIssue
        ? "Docker daemon 未就绪：连不上本机的 Docker 引擎（npipe），先启动 Docker Desktop，再点右上角刷新。"
        : `Docker daemon 未就绪：${raw}`,
    };
  }

  const [ps, images] = await Promise.all([
    run("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"], { timeout: 12000 }),
    run("docker", ["images", "--format", "{{json .}}"], { timeout: 12000 }),
  ]);

  const containers = parseJsonLines(ps.stdout).map((item) => {
    const labels = String(item.Labels ?? "");
    const compose = /com\.docker\.compose\.project=([^,]+)/.exec(labels)?.[1];
    return {
      id: String(item.ID ?? "").slice(0, 12),
      name: String(item.Names ?? "").split(",")[0],
      image: String(item.Image ?? ""),
      state: normalizeState(item.State),
      health: containerHealth(item.Status),
      ports: portList(item.Ports),
      cpuPercent: 0,
      memMb: 0,
      memLimitMb: 0,
      uptime: String(item.RunningFor ?? item.Status ?? ""),
      compose: compose ?? undefined,
      restarts: 0,
    };
  });

  const running = containers.filter((item) => item.state === "running");
  if (running.length > 0) {
    const stats = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 9000 });
    const byName = new Map(parseJsonLines(stats.stdout).map((item) => [String(item.Name ?? ""), item]));
    for (const container of containers) {
      const item = byName.get(container.name);
      if (!item) continue;
      container.cpuPercent = Number.parseFloat(String(item.CPUPerc ?? "0").replace("%", "")) || 0;
      const [used, limit] = String(item.MemUsage ?? "").split("/");
      container.memMb = sizeToMb(used);
      container.memLimitMb = sizeToMb(limit);
    }
  }

  const imageRows = parseJsonLines(images.stdout).map((item) => {
    const repo = String(item.Repository ?? "");
    const tag = String(item.Tag ?? "");
    return {
      id: String(item.ID ?? ""),
      repo: repo === "<none>" ? "（悬空镜像）" : repo,
      tag: tag === "<none>" ? "none" : tag,
      sizeMb: sizeToMb(item.Size),
      created: dockerDate(item.CreatedAt),
      usedBy: containers.filter((container) => container.image === `${repo}:${tag}` || container.image === repo).length,
    };
  });

  const projectMap = new Map();
  for (const container of containers) {
    if (!container.compose) continue;
    const entry = projectMap.get(container.compose) ?? { name: container.compose, path: "", services: 0, running: 0 };
    entry.services += 1;
    if (container.state === "running") entry.running += 1;
    projectMap.set(container.compose, entry);
  }
  const projects = [...projectMap.values()].map((item) => ({
    ...item,
    status: item.running === item.services ? "running" : item.running === 0 ? "stopped" : "partial",
  }));

  return { containers, images: imageRows, projects };
}

/* ---------------- Git ---------------- */

function candidateRepos() {
  const configured = (process.env.QS_GIT_REPOS ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  const roots = [];
  const base = process.cwd();
  for (const candidate of [base, path.dirname(base)]) {
    if (fs.existsSync(path.join(candidate, ".git"))) roots.push(candidate);
    try {
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const child = path.join(candidate, entry.name);
        if (fs.existsSync(path.join(child, ".git"))) roots.push(child);
        if (roots.length >= 12) break;
      }
    } catch {
      /* 目录不可读时跳过 */
    }
  }
  return roots;
}

async function readRepo(root) {
  const name = path.basename(root);
  const [status, remote, last, log, branches, objects] = await Promise.all([
    run("git", ["-C", root, "status", "--porcelain=v2", "--branch"], { timeout: 8000 }),
    run("git", ["-C", root, "config", "--get", "remote.origin.url"], { timeout: 4000 }),
    run("git", ["-C", root, "log", "-1", "--date=iso-strict", "--pretty=format:%aI%x1f%s"], { timeout: 6000 }),
    run("git", ["-C", root, "log", "-20", "--numstat", "--pretty=format:%x01%H%x1f%h%x1f%an%x1f%aI%x1f%s"], {
      timeout: 12000,
    }),
    run(
      "git",
      ["-C", root, "for-each-ref", "--format=%(refname:short)%1f%(committerdate:iso-strict)%1f%(authorname)%1f%(upstream:track)", "refs/heads"],
      { timeout: 6000 },
    ),
    run("git", ["-C", root, "count-objects", "-v"], { timeout: 6000 }),
  ]);

  if (!status.ok) return null;

  let branch = "HEAD";
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of status.stdout.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length).trim();
    else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line.trim()) dirty += 1;
  }

  const lastParts = last.stdout.split("\x1f");
  const commitRows = [];
  for (const block of log.stdout.split("\x01")) {
    const text = block.replace(/^\r?\n/, "");
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    const head = lines[0].split("\x1f");
    if (head.length < 5) continue;
    let insertions = 0;
    let deletions = 0;
    let files = 0;
    for (const stat of lines.slice(1)) {
      const cells = stat.split("\t");
      if (cells.length < 3) continue;
      files += 1;
      insertions += Number.parseInt(cells[0], 10) || 0;
      deletions += Number.parseInt(cells[1], 10) || 0;
    }
    commitRows.push({
      hash: head[0],
      short: head[1],
      subject: head[4],
      author: head[2],
      when: head[3],
      insertions,
      deletions,
      files,
    });
  }

  const branchRows = branches.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [branchName, when, author, track] = line.split("\x1f");
      const match = /ahead (\d+)/.exec(track ?? "");
      const behindMatch = /behind (\d+)/.exec(track ?? "");
      return {
        name: branchName,
        ahead: match ? Number(match[1]) : 0,
        behind: behindMatch ? Number(behindMatch[1]) : 0,
        isDefault: branchName === "main" || branchName === "master",
        lastCommitAt: when || new Date().toISOString(),
        author: author || "—",
      };
    });

  const packKb = /size-pack:\s*(\d+)/.exec(objects.stdout)?.[1] ?? "0";

  return {
    repo: {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      path: root,
      branch,
      remote: (remote.stdout || "—").trim(),
      ahead,
      behind,
      dirty,
      lastCommitAt: lastParts[0] || new Date().toISOString(),
      lastCommitSubject: lastParts[1] || "",
      sizeMb: Math.round(Number(packKb) / 1024 * 10) / 10,
    },
    commits: commitRows,
    branches: branchRows,
  };
}

async function gitSnapshot() {
  if (!hasCommand("git")) {
    return { repos: [], commits: {}, branches: {}, note: "未在 PATH 中找到 git 命令。" };
  }
  const roots = candidateRepos();
  const repos = [];
  const commits = {};
  const branches = {};
  for (const root of roots) {
    const result = await readRepo(root);
    if (!result) continue;
    repos.push(result.repo);
    commits[result.repo.id] = result.commits;
    branches[result.repo.id] = result.branches;
  }
  return {
    repos,
    commits,
    branches,
    note: repos.length === 0 ? "没有找到 git 仓库。用 QS_GIT_REPOS 指定仓库根目录，或把 agent 放在仓库目录下启动。" : undefined,
  };
}

/* ---------------- 其余数据源：本轮优雅降级 ---------------- */

function emptyMysql(note) {
  return { instances: [], slowQueries: [], tables: [], note };
}

function emptyTerraform(note) {
  return { workspaces: [], changes: {}, note };
}

function emptyAnsible(note) {
  return {
    hosts: [],
    playbooks: [],
    recentRun: { playbook: "—", startedAt: new Date().toISOString(), status: "success", tasks: [] },
    note,
  };
}

function emptyJenkins(note) {
  return { jobs: [], builds: [], nodes: [], queue: 0, note };
}

async function observabilitySnapshot() {
  const prom = (process.env.QS_PROMETHEUS_URL ?? "").replace(/\/$/, "");
  const grafana = (process.env.QS_GRAFANA_URL ?? "").replace(/\/$/, "");
  const token = process.env.QS_GRAFANA_TOKEN ?? "";
  const targets = [];
  const alerts = [];
  const dashboards = [];
  const notes = [];

  if (prom) {
    try {
      const [targetResponse, alertResponse] = await Promise.all([
        fetch(`${prom}/api/v1/targets`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${prom}/api/v1/alerts`, { signal: AbortSignal.timeout(5000) }),
      ]);
      const targetJson = await targetResponse.json();
      const alertJson = await alertResponse.json();
      for (const item of targetJson?.data?.activeTargets ?? []) {
        targets.push({
          job: item.labels?.job ?? "—",
          instance: item.labels?.instance ?? item.scrapeUrl ?? "—",
          health: item.health === "up" ? "up" : "down",
          lastScrape: item.lastScrape ?? new Date().toISOString(),
          scrapeDurationMs: Math.round((item.lastScrapeDuration ?? 0) * 1000),
          labels: item.labels ?? {},
        });
      }
      for (const item of alertJson?.data?.alerts ?? []) {
        const severity = item.labels?.severity === "critical" ? "critical" : item.labels?.severity === "warning" ? "warning" : "info";
        alerts.push({
          name: item.labels?.alertname ?? "—",
          severity,
          state: item.state === "firing" ? "firing" : item.state === "pending" ? "pending" : "inactive",
          since: item.activeAt,
          summary: item.annotations?.summary ?? item.annotations?.description ?? "",
          value: item.value ? String(item.value) : undefined,
        });
      }
    } catch (error) {
      notes.push(`Prometheus 读取失败：${firstLine(error?.message ?? error)}`);
    }
  } else {
    notes.push("未配置 QS_PROMETHEUS_URL，未读取 targets / alerts。");
  }

  if (grafana) {
    try {
      const response = await fetch(`${grafana}/api/search?type=dash-db&limit=30`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = await response.json();
      for (const item of Array.isArray(list) ? list : []) {
        dashboards.push({
          uid: item.uid ?? item.id ?? "—",
          title: item.title ?? "未命名",
          folder: item.folderTitle || "General",
          panels: 0,
          updatedAt: new Date().toISOString(),
          url: `${grafana}/d/${item.uid ?? item.id}`,
        });
      }
    } catch (error) {
      notes.push(`Grafana 读取失败：${firstLine(error?.message ?? error)}`);
    }
  } else {
    notes.push("未配置 QS_GRAFANA_URL，未读取仪表盘。");
  }

  return { targets, alerts, dashboards, series: [], scrapeIntervalSec: 15, note: notes.join(" ") || undefined };
}

/* ---------------- 数据源状态 ---------------- */

const SOURCE_META = [
  { id: "docker", label: "Docker" },
  { id: "mysql", label: "MySQL" },
  { id: "terraform", label: "Terraform" },
  { id: "ansible", label: "Ansible" },
  { id: "git", label: "Git" },
  { id: "jenkins", label: "Jenkins" },
  { id: "prometheus", label: "Prometheus" },
  { id: "grafana", label: "Grafana" },
];

async function sourcesSnapshot() {
  const now = new Date().toISOString();
  const dockerStart = Date.now();
  const docker = await cached("docker", 5000, dockerSnapshot);
  const dockerLatency = Date.now() - dockerStart;
  const dockerUp = docker.containers.length > 0 || !docker.note;
  const git = await cached("git", 5000, gitSnapshot);

  const rows = {
    docker: dockerUp
      ? { health: "up", detail: `${docker.containers.filter((item) => item.state === "running").length}/${docker.containers.length} 个容器运行中`, latencyMs: dockerLatency }
      : { health: "down", detail: docker.note ?? "Docker daemon 不可用" },
    git: git.repos.length > 0
      ? { health: "up", detail: `${git.repos.length} 个仓库 · ${git.repos.reduce((sum, item) => sum + item.dirty, 0)} 个未提交改动` }
      : { health: "down", detail: git.note ?? "没有找到 git 仓库" },
    mysql: hasCommand("mysql")
      ? { health: "down", detail: "检测到 mysql 客户端，但本轮尚未实现指标采集" }
      : { health: "down", detail: "未安装 mysql 客户端 / 未配置连接" },
    terraform: hasCommand("terraform")
      ? { health: "down", detail: "检测到 terraform，但本轮尚未实现工作区采集" }
      : { health: "down", detail: "未安装 terraform / 未配置状态后端" },
    ansible: hasCommand("ansible")
      ? { health: "down", detail: "检测到 ansible，但本轮尚未实现 inventory 解析" }
      : { health: "down", detail: "未安装 ansible / 未配置 inventory" },
    jenkins: { health: "down", detail: "未配置 Jenkins 地址或 token" },
    prometheus: process.env.QS_PROMETHEUS_URL
      ? { health: "degraded", detail: "已配置，等待首次抓取" }
      : { health: "down", detail: "未配置 QS_PROMETHEUS_URL" },
    grafana: process.env.QS_GRAFANA_URL
      ? { health: "degraded", detail: "已配置，仪表盘列表按需读取" }
      : { health: "down", detail: "未配置 QS_GRAFANA_URL" },
  };

  return SOURCE_META.map((meta) => ({
    id: meta.id,
    label: meta.label,
    health: rows[meta.id].health,
    detail: rows[meta.id].detail,
    latencyMs: rows[meta.id].latencyMs,
    version: meta.id === "docker" && dockerUp ? undefined : undefined,
    checkedAt: now,
  }));
}

/* ---------------- 白名单执行 ---------------- */

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REPO_PATH = /^[^\r\n"]{1,260}$/;
const JOB_NAME = /^[A-Za-z0-9_.-]{1,120}$/;

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

function assert(condition, status, detail) {
  if (!condition) throw new HttpError(status, detail);
}

function resolveRepo(target) {
  assert(REPO_PATH.test(target), 400, "仓库路径不合法");
  const resolved = path.resolve(target);
  const known = candidateRepos().some((root) => {
    const left = path.resolve(root);
    return process.platform === "win32" ? left.toLowerCase() === resolved.toLowerCase() : left === resolved;
  });
  assert(known, 403, "只允许对 agent 已发现的本机仓库执行：把它加进 QS_GIT_REPOS，或把 agent 放在仓库里启动");
  assert(fs.existsSync(path.join(resolved, ".git")), 403, `${resolved} 不是 Git 仓库`);
  return resolved;
}

/** 返回要执行的 argv；jenkins.build 走 HTTP，返回 null。 */
function planAction(action, target) {
  switch (action) {
    case "docker.restart":
    case "docker.start":
    case "docker.stop": {
      assert(CONTAINER_NAME.test(target), 400, "容器名不合法");
      const verb = action.slice("docker.".length);
      return { argv: ["docker", verb, target], display: `docker ${verb} ${target}` };
    }
    case "git.fetch": {
      const root = resolveRepo(target);
      return { argv: ["git", "-C", root, "fetch", "--prune"], display: `git -C "${root}" fetch --prune` };
    }
    case "git.pull": {
      const root = resolveRepo(target);
      return { argv: ["git", "-C", root, "pull", "--ff-only"], display: `git -C "${root}" pull --ff-only` };
    }
    case "jenkins.build":
      assert(JOB_NAME.test(target), 400, "流水线名不合法");
      return null;
    default:
      throw new HttpError(400, `未知动作 ${action}`);
  }
}

function audit(record) {
  const line = JSON.stringify({
    at: record.at,
    action: record.action,
    target: record.target,
    command: record.command,
    ok: record.ok,
    durationMs: record.durationMs,
    origin: record.origin ?? "",
    pid: process.pid,
  });
  try {
    fs.appendFileSync(AUDIT_FILE, `${line}\n`);
  } catch {
    /* 审计写不进去也不能挡住已经执行的动作 */
  }
}

async function executeAction(action, target, origin) {
  const started = Date.now();
  const at = new Date(started).toISOString();
  let command = "";

  try {
    const plan = planAction(action, target);
    let ok = false;
    let stdout = "";
    let stderr = "";

    if (plan) {
      command = plan.display;
      const result = await run(plan.argv[0], plan.argv.slice(1), { timeout: 30_000 });
      ok = result.ok;
      stdout = result.stdout;
      stderr = result.stderr || result.error;
    } else {
      const base = (process.env.QS_JENKINS_URL ?? "").replace(/\/+$/, "");
      assert(base, 501, "没有配置 QS_JENKINS_URL，构建不会下发");
      command = `POST ${base}/job/${target}/build`;
      const headers = {};
      const user = process.env.QS_JENKINS_USER ?? "";
      const token = process.env.QS_JENKINS_TOKEN ?? "";
      if (user && token) headers.Authorization = `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`${base}/job/${encodeURIComponent(target)}/build`, {
          method: "POST",
          headers,
          signal: controller.signal,
        });
        ok = response.ok;
        stdout = `HTTP ${response.status} ${response.statusText}`.trim();
        if (!response.ok) stderr = firstLine(await response.text().catch(() => ""), 400) || stdout;
      } catch (error) {
        stderr = firstLine(error?.message ?? error, 400);
      } finally {
        clearTimeout(timer);
      }
    }

    const outcome = {
      action,
      command,
      ok,
      stdout: String(stdout ?? "").slice(0, 4000),
      stderr: String(stderr ?? "").slice(0, 4000),
      durationMs: Date.now() - started,
      at,
    };
    audit({ ...outcome, target, origin });
    return outcome;
  } catch (error) {
    audit({
      action,
      target,
      command: command || `${action} ${target}`,
      ok: false,
      durationMs: Date.now() - started,
      at,
      origin,
    });
    throw error;
  }
}

async function readJsonBody(request, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "请求体太大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

function tokenMatches(request) {
  const given = Buffer.from(String(request.headers["x-qingshan-token"] ?? ""), "utf8");
  const expected = Buffer.from(AGENT_TOKEN, "utf8");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* ---------------- HTTP ---------------- */

const ROUTES = {
  "/api/health": async () => ({
    ok: true,
    name: "qingshan-devops-agent",
    version: VERSION,
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks: {
      docker: hasCommand("docker"),
      git: hasCommand("git"),
      terraform: hasCommand("terraform"),
      ansible: hasCommand("ansible"),
      mysql: hasCommand("mysql"),
    },
  }),
  "/api/sources": () => sourcesSnapshot(),
  "/api/docker": () => cached("docker", 4000, dockerSnapshot),
  "/api/git": () => cached("git", 4000, gitSnapshot),
  "/api/mysql": async () => emptyMysql("本轮尚未实现 MySQL 采集：需要 mysql 客户端与只读账号。"),
  "/api/terraform": async () => emptyTerraform("本轮尚未实现 Terraform 采集：需要 terraform 命令与状态后端。"),
  "/api/ansible": async () => emptyAnsible("本轮尚未实现 Ansible 采集：需要 inventory 文件与 ansible 命令。"),
  "/api/jenkins": async () => emptyJenkins("本轮尚未实现 Jenkins 采集：需要 Base URL 与 API token。"),
  "/api/observability": () => cached("observability", 4000, observabilitySnapshot),
};

function loopbackOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return origin;
  } catch {
    /* 非法 Origin 直接拒绝 */
  }
  return null;
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleActions(request, response) {
  const origin = String(request.headers.origin ?? "");
  if (origin && !loopbackOrigin(request)) throw new HttpError(403, "只接受来自本机页面的执行请求");
  if (!tokenMatches(request)) throw new HttpError(401, "执行令牌不对：把 agent 启动日志里的「执行令牌」填到设置页");
  const body = await readJsonBody(request);
  const action = String(body.action ?? "");
  const target = String(body.target ?? "");
  const outcome = await executeAction(action, target, origin);
  send(response, 200, outcome);
}

const server = http.createServer(async (request, response) => {
  const origin = loopbackOrigin(request);
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Qingshan-Token",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  try {
    if (request.method === "POST") {
      if (url.pathname !== "/api/actions") throw new HttpError(404, `未知接口 ${url.pathname}`);
      await handleActions(request, response);
      return;
    }

    if (request.method !== "GET") throw new HttpError(405, "只支持 GET 与 POST /api/actions");

    const handler = ROUTES[url.pathname];
    if (!handler) throw new HttpError(404, `未知接口 ${url.pathname}`);
    send(response, 200, await handler());
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const detail =
      error instanceof HttpError ? error.message : firstLine(error?.stack ?? error?.message ?? error, 600);
    send(response, status, { detail });
  }
});

server.listen(PORT, HOST, () => {
  const banner = [
    `青衫 DevOps agent v${VERSION}`,
    `监听 http://${HOST}:${PORT}（只绑定回环地址）`,
    `执行令牌：${AGENT_TOKEN}`,
    `审计日志：${AUDIT_FILE}`,
    `docker=${hasCommand("docker") ? "yes" : "no"} git=${hasCommand("git") ? "yes" : "no"} jenkins=${process.env.QS_JENKINS_URL ? "yes" : "no"} node=${process.version}`,
    `git 根目录：${candidateRepos().join(" | ") || "（无）"}`,
  ];
  console.log(banner.join("\n"));
});

process.on("SIGINT", () => {
  console.log("\nagent 已停止");
  server.close(() => process.exit(0));
});
