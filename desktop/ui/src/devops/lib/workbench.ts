import { relTime, seconds } from "./format";
import type {
  ActionId,
  BuildResult,
  DockerContainer,
  DockerSnapshot,
  GitSnapshot,
  JenkinsSnapshot,
  MysqlSnapshot,
  ObservabilitySnapshot,
  PageKey,
  Settings,
} from "./types";

export type Tone = "ok" | "warn" | "err" | "idle";

export interface ChainLink {
  key: "commit" | "build" | "image" | "runtime";
  label: string;
  value: string;
  meta: string;
  tone: Tone;
}

export interface PendingItem {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  page: PageKey;
}

export type QuickAction =
  | { kind: "run"; id: ActionId; target: string; label: string; hint: string; danger: boolean }
  | { kind: "link"; page: PageKey; label: string; hint: string };

export interface Workbench {
  project: { name: string; services: number; running: number; path: string } | null;
  repo: { name: string; path: string; branch: string; behind: number; ahead: number; dirty: number } | null;
  job: { name: string } | null;
  commit: { short: string; subject: string; author: string; at: string } | null;
  build: { job: string; number: number; result: BuildResult; startedAt: string; durationSec: number; commit?: string } | null;
  links: ChainLink[];
  consistency: { state: "ok" | "warn" | "unknown"; detail: string };
  pending: PendingItem[];
  actions: QuickAction[];
}

export interface WorkbenchInput {
  docker: DockerSnapshot;
  git: GitSnapshot;
  jenkins: JenkinsSnapshot;
  observability: ObservabilitySnapshot;
  mysql: MysqlSnapshot;
  settings: Settings;
  /** 用户在工作台上下文条里选的项目；不传则自动挑容器最多的那个 */
  project?: string;
}

const RESULT_LABEL: Record<BuildResult, string> = {
  success: "成功",
  failure: "失败",
  unstable: "不稳定",
  running: "构建中",
  never: "未构建",
};

const TONE_ORDER: Record<Tone, number> = { err: 0, warn: 1, idle: 2, ok: 3 };

function pickProject(docker: DockerSnapshot, wanted?: string) {
  const projects = [...docker.projects];
  if (wanted) {
    const exact = projects.find((item) => item.name === wanted);
    if (exact) return exact;
  }
  return projects.sort((a, b) => b.running - a.running || b.services - a.services)[0] ?? null;
}

function pickRepo(git: GitSnapshot, hint: string) {
  if (git.repos.length === 0) return null;
  const lowered = hint.toLowerCase();
  const named = git.repos.find((item) => item.name.toLowerCase() === lowered);
  if (named) return named;
  const contained = git.repos.find((item) => item.name.toLowerCase().includes(lowered) || lowered.includes(item.name.toLowerCase()));
  if (contained) return contained;
  return [...git.repos].sort((a, b) => b.lastCommitAt.localeCompare(a.lastCommitAt))[0] ?? null;
}

function pickJob(jenkins: JenkinsSnapshot, hint: string) {
  if (jenkins.jobs.length === 0) return null;
  const lowered = hint.toLowerCase();
  return (
    jenkins.jobs.find((item) => item.name.toLowerCase().startsWith(lowered)) ??
    jenkins.jobs.find((item) => item.name.toLowerCase().includes(lowered)) ??
    [...jenkins.jobs].sort((a, b) => b.lastBuild - a.lastBuild)[0] ??
    null
  );
}

function latestBuild(jenkins: JenkinsSnapshot, job: string) {
  const rows = jenkins.builds.filter((item) => item.job === job);
  if (rows.length === 0) return null;
  return rows.reduce((best, item) => (item.number > best.number ? item : best));
}

function pickContainer(docker: DockerSnapshot, project: string | null, hint: string): DockerContainer | null {
  const scoped = project ? docker.containers.filter((item) => item.compose === project) : docker.containers;
  const pool = scoped.length > 0 ? scoped : docker.containers;
  const running = pool.filter((item) => item.state === "running");
  const preferred = running.find((item) => item.image.toLowerCase().includes(hint.toLowerCase()));
  return preferred ?? running[0] ?? pool[0] ?? null;
}

function worstContainer(containers: DockerContainer[]): DockerContainer | null {
  const unhealthy = containers.find((item) => item.health === "unhealthy");
  if (unhealthy) return unhealthy;
  const stopped = containers.find((item) => item.state === "exited" || item.state === "paused");
  if (stopped) return stopped;
  const flapping = [...containers].filter((item) => item.restarts > 0).sort((a, b) => b.restarts - a.restarts)[0];
  return flapping ?? null;
}

function imageTag(ref: string): string {
  const last = ref.split("/").pop() ?? ref;
  return last;
}

export function deriveWorkbench(input: WorkbenchInput): Workbench {
  const { docker, git, jenkins, observability, mysql } = input;
  const project = pickProject(docker, input.project);
  const hint = project ? project.name.split("-")[0] : (git.repos[0]?.name ?? "app");

  const repo = pickRepo(git, hint);
  const job = pickJob(jenkins, hint);
  const build = job ? latestBuild(jenkins, job.name) : null;
  const commit = repo
    ? { short: "", subject: repo.lastCommitSubject, author: "", at: repo.lastCommitAt }
    : null;
  if (repo && commit) {
    const head = git.commits[repo.id]?.[0];
    if (head) {
      commit.short = head.short;
      commit.author = head.author;
      commit.subject = head.subject;
      commit.at = head.when;
    }
  }

  const container = pickContainer(docker, project?.name ?? null, hint);
  const scoped = project ? docker.containers.filter((item) => item.compose === project.name) : docker.containers;
  const runningCount = scoped.filter((item) => item.state === "running").length;
  const unhealthy = scoped.filter((item) => item.health === "unhealthy").length;

  const consistency = buildState(commit?.short ?? "", build?.commit);
  const links: ChainLink[] = [
    commitLink(commit, repo?.branch ?? ""),
    buildLink(build, job?.name ?? ""),
    imageLink(container),
    runtimeLink(scoped.length, runningCount, unhealthy),
  ];

  const pending: PendingItem[] = [];
  if (consistency.state === "warn") {
    pending.push({
      id: "version",
      tone: "warn",
      title: "已构建的版本落后于 HEAD",
      detail: consistency.detail,
      page: "jenkins",
    });
  }
  for (const alert of observability.alerts.filter((item) => item.state === "firing")) {
    pending.push({
      id: `alert:${alert.name}`,
      tone: alert.severity === "critical" ? "err" : "warn",
      title: alert.name,
      detail: `${alert.summary}${alert.since ? ` · 自 ${relTime(alert.since)}` : ""}`,
      page: "observability",
    });
  }
  for (const failed of jenkins.jobs.filter((item) => item.status === "failure")) {
    pending.push({
      id: `job:${failed.name}`,
      tone: "err",
      title: `${failed.name} 构建失败`,
      detail: `#${failed.lastBuild} · 健康度 ${failed.health}`,
      page: "jenkins",
    });
  }
  for (const item of scoped.filter((row) => row.health === "unhealthy" || row.state === "exited").slice(0, 2)) {
    pending.push({
      id: `container:${item.name}`,
      tone: item.health === "unhealthy" ? "err" : "warn",
      title: `${item.name} ${item.state === "exited" ? "已退出" : "健康检查未通过"}`,
      detail: `${item.image} · 重启 ${item.restarts} 次`,
      page: "docker",
    });
  }
  for (const instance of mysql.instances.filter((item) => item.health !== "up").slice(0, 2)) {
    pending.push({
      id: `mysql:${instance.id}`,
      tone: instance.health === "degraded" ? "warn" : "err",
      title: `${instance.host} ${instance.health === "degraded" ? "降级" : "不可用"}`,
      detail:
        instance.replicationLagSec !== null
          ? `复制延迟 ${instance.replicationLagSec} 秒`
          : `${instance.role === "primary" ? "主库" : "副本"} · ${instance.connections} 个连接`,
      page: "databases",
    });
  }
  if (repo && repo.behind > 0) {
    pending.push({
      id: `git:${repo.id}`,
      tone: "warn",
      title: `${repo.name} 落后 ${repo.behind} 个提交`,
      detail: `${repo.branch} 需要 pull 才能与远端对齐`,
      page: "git",
    });
  }
  if (repo && repo.dirty > 0) {
    pending.push({
      id: `git-dirty:${repo.id}`,
      tone: "idle",
      title: `${repo.name} 有 ${repo.dirty} 个未提交改动`,
      detail: "pull 之前先确认这些改动是不是你要的",
      page: "git",
    });
  }
  if (!project && docker.containers.length === 0 && docker.note) {
    pending.push({
      id: "docker-empty",
      tone: "warn",
      title: "Docker 没有返回容器",
      detail: docker.note,
      page: "docker",
    });
  }

  pending.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  const actions: QuickAction[] = [];
  if (job) {
    actions.push({
      kind: "run",
      id: "jenkins.build",
      target: job.name,
      label: `构建 ${job.name}`,
      hint: commit?.short ? `把 HEAD ${commit.short} 跑一遍` : "触发一次流水线",
      danger: false,
    });
  }
  if (repo) {
    actions.push(
      repo.behind > 0
        ? {
            kind: "run",
            id: "git.pull",
            target: repo.path,
            label: `拉取 ${repo.name}`,
            hint: `${repo.branch} 落后 ${repo.behind} 个提交`,
            danger: false,
          }
        : {
            kind: "run",
            id: "git.fetch",
            target: repo.path,
            label: `更新 ${repo.name} 远端引用`,
            hint: "只更新 origin/*，不动工作区",
            danger: false,
          },
    );
  }
  const restartTarget = worstContainer(scoped.length > 0 ? scoped : docker.containers);
  if (restartTarget) {
    actions.push({
      kind: "run",
      id: "docker.restart",
      target: restartTarget.name,
      label: `重启 ${restartTarget.name}`,
      hint:
        restartTarget.health === "unhealthy"
          ? "健康检查未通过"
          : restartTarget.restarts > 0
            ? `已重启 ${restartTarget.restarts} 次`
            : "确认配置改动后重启",
      danger: true,
    });
  }
  actions.push({
    kind: "link",
    page: "dockerfile",
    label: "导出 Dockerfile",
    hint: "把容器配置写成可提交的产物",
  });

  return {
    project: project
      ? { name: project.name, services: project.services, running: project.running, path: project.path }
      : null,
    repo: repo
      ? { name: repo.name, path: repo.path, branch: repo.branch, behind: repo.behind, ahead: repo.ahead, dirty: repo.dirty }
      : null,
    job: job ? { name: job.name } : null,
    commit,
    build,
    links,
    consistency,
    pending: pending.slice(0, 8),
    actions,
  };
}

function buildState(head: string, built?: string): Workbench["consistency"] {
  if (!built) {
    return { state: "unknown", detail: "Jenkins 没有回写构建对应的 commit，无法核对" };
  }
  if (!head) {
    return { state: "unknown", detail: "没有读到 HEAD，无法核对" };
  }
  if (built.startsWith(head.slice(0, 7)) || head.startsWith(built.slice(0, 7))) {
    return { state: "ok", detail: `构建与 HEAD 一致（${head.slice(0, 7)}）` };
  }
  return { state: "warn", detail: `构建 ${built.slice(0, 7)} · HEAD ${head.slice(0, 7)}` };
}

function commitLink(commit: Workbench["commit"], branch: string): ChainLink {
  if (!commit) {
    return { key: "commit", label: "提交", value: "没有读到仓库", meta: "配置 QS_GIT_REPOS 或把 agent 放在仓库里启动", tone: "idle" };
  }
  return {
    key: "commit",
    label: "提交",
    value: commit.short ? `${branch}@${commit.short}` : "未取到 HEAD",
    meta: `${commit.subject || "—"}${commit.author ? ` · ${commit.author}` : ""} · ${relTime(commit.at)}`,
    tone: commit.short ? "ok" : "idle",
  };
}

function buildLink(build: Workbench["build"], job: string): ChainLink {
  if (!build) {
    return { key: "build", label: "构建", value: "没有构建记录", meta: job ? `${job} 还没跑过` : "没有可用的流水线", tone: "idle" };
  }
  return {
    key: "build",
    label: "构建",
    value: `#${build.number} ${RESULT_LABEL[build.result]}`,
    meta: `${build.job} · ${relTime(build.startedAt)} · ${seconds(build.durationSec)}${build.commit ? ` · ${build.commit.slice(0, 7)}` : ""}`,
    tone: build.result === "success" ? "ok" : build.result === "running" ? "warn" : build.result === "failure" ? "err" : "warn",
  };
}

function imageLink(container: DockerContainer | null): ChainLink {
  if (!container) {
    return { key: "image", label: "镜像", value: "没有运行中的容器", meta: "Docker 未返回可用容器", tone: "idle" };
  }
  return {
    key: "image",
    label: "镜像",
    value: imageTag(container.image),
    meta: `${container.name}${container.ports.length > 0 ? ` · ${container.ports[0]}` : ""}`,
    tone: container.state === "running" ? "ok" : "err",
  };
}

function runtimeLink(total: number, running: number, unhealthy: number): ChainLink {
  if (total === 0) {
    return { key: "runtime", label: "运行", value: "没有容器", meta: "项目还没有启动过", tone: "idle" };
  }
  return {
    key: "runtime",
    label: "运行",
    value: `${running}/${total} 运行中`,
    meta: unhealthy > 0 ? `${unhealthy} 个健康检查未通过` : "健康检查全部通过",
    tone: unhealthy > 0 ? "err" : running === total ? "ok" : "warn",
  };
}

export function consistencyLabel(state: Workbench["consistency"]["state"]): { tone: Tone; text: string } {
  if (state === "ok") return { tone: "ok", text: "版本一致" };
  if (state === "warn") return { tone: "warn", text: "版本不一致" };
  return { tone: "idle", text: "无法核对" };
}
