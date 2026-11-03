export type PageKey =
  | "workbench"
  | "docker"
  | "dockerfile"
  | "databases"
  | "terraform"
  | "ansible"
  | "git"
  | "jenkins"
  | "observability"
  | "settings";

/**
 * 顶层模块。监控只看不改；编辑只产出配置与命令。
 * 两个模块共用同一套数据源、设计 token 与设置。
 */
export type Surface = "monitor" | "editor";

export type SourceId =
  | "docker"
  | "mysql"
  | "terraform"
  | "ansible"
  | "git"
  | "jenkins"
  | "prometheus"
  | "grafana";

export type Health = "up" | "down" | "degraded" | "unknown";

export type EnvName = "dev" | "staging" | "prod";

export interface SourceState {
  id: SourceId;
  label: string;
  health: Health;
  detail: string;
  version?: string;
  endpoint?: string;
  latencyMs?: number;
  checkedAt: string;
}

/** 本地 agent 的可用性快照：连接不上时前端进入降级状态而不是白屏。 */
export interface AgentState {
  reachable: boolean;
  url: string;
  detail: string;
}

/* ---------- Docker ---------- */

export type ContainerState = "running" | "exited" | "paused" | "restarting";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  health: "healthy" | "unhealthy" | "none";
  ports: string[];
  cpuPercent: number;
  memMb: number;
  memLimitMb: number;
  uptime: string;
  compose?: string;
  restarts: number;
  /** docker ps 的 Command 字段，用于反推启动命令 */
  command?: string;
}

export interface DockerImage {
  id: string;
  repo: string;
  tag: string;
  sizeMb: number;
  created: string;
  usedBy: number;
}

export interface DockerProject {
  name: string;
  path: string;
  services: number;
  running: number;
  status: "running" | "partial" | "stopped";
}

export interface DockerSnapshot {
  containers: DockerContainer[];
  images: DockerImage[];
  projects: DockerProject[];
  /** Docker 主机逻辑核心数，用于把容器 CPU% 换算成主机占用比例 */
  cpuCount?: number;
  /** Docker 主机内存上限（MB），缺失时回退容器限额合计 */
  memoryTotalMb?: number;
  /** agent 侧采集失败或降级时的中文说明 */
  note?: string;
}

/* ---------- MySQL ---------- */

export interface MysqlInstance {
  id: string;
  host: string;
  port: number;
  version: string;
  role: "primary" | "replica";
  health: Health;
  connections: number;
  maxConnections: number;
  qps: number;
  slowQueries: number;
  replicationLagSec: number | null;
  uptime: string;
}

export interface SlowQuery {
  digest: string;
  sql: string;
  execCount: number;
  avgMs: number;
  rowsExamined: number;
  lastSeen: string;
}

export interface DbTable {
  schema: string;
  table: string;
  rows: number;
  sizeMb: number;
  engine: string;
}

export interface MysqlSnapshot {
  instances: MysqlInstance[];
  slowQueries: SlowQuery[];
  tables: DbTable[];
  note?: string;
}

/* ---------- Terraform ---------- */

export type TfAction = "create" | "update" | "replace" | "delete" | "read";

export interface TerraformWorkspace {
  name: string;
  env: EnvName;
  resources: number;
  stateVersion: number;
  backend: string;
  drift: { create: number; update: number; delete: number };
  lastRun: string;
  lastRunStatus: "applied" | "planned" | "failed" | "never";
  lastRunDurationSec: number;
}

export interface TerraformChange {
  address: string;
  module: string;
  action: TfAction;
  detail: string;
  provider: string;
}

export interface TerraformSnapshot {
  workspaces: TerraformWorkspace[];
  changes: Record<string, TerraformChange[]>;
  note?: string;
}

/* ---------- Ansible ---------- */

export interface AnsibleHost {
  name: string;
  group: string;
  address: string;
  reachable: boolean;
  lastResult: "ok" | "failed" | "unreachable" | "never";
}

export interface AnsiblePlaybook {
  name: string;
  path: string;
  hosts: string;
  tasks: number;
  lastRun: string | null;
  status: "success" | "failed" | "never";
  durationSec: number;
}

export interface AnsibleTaskRun {
  task: string;
  host: string;
  status: "ok" | "changed" | "failed" | "skipped";
  durationMs: number;
  detail?: string;
}

export interface AnsibleSnapshot {
  hosts: AnsibleHost[];
  playbooks: AnsiblePlaybook[];
  recentRun: {
    playbook: string;
    startedAt: string;
    status: "success" | "failed";
    tasks: AnsibleTaskRun[];
  };
  note?: string;
}

/* ---------- Git ---------- */

export interface GitRepo {
  id: string;
  name: string;
  path: string;
  branch: string;
  remote: string;
  ahead: number;
  behind: number;
  dirty: number;
  lastCommitAt: string;
  lastCommitSubject: string;
  sizeMb: number;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  when: string;
  insertions: number;
  deletions: number;
  files: number;
}

export interface GitBranchInfo {
  name: string;
  ahead: number;
  behind: number;
  isDefault: boolean;
  lastCommitAt: string;
  author: string;
}

export interface GitSnapshot {
  repos: GitRepo[];
  commits: Record<string, GitCommit[]>;
  branches: Record<string, GitBranchInfo[]>;
  note?: string;
}

/* ---------- Jenkins ---------- */

export type BuildResult = "success" | "failure" | "unstable" | "running" | "never";

export interface JenkinsJob {
  name: string;
  folder: string;
  status: BuildResult;
  lastBuild: number;
  durationSec: number;
  health: number;
  enabled: boolean;
  history: BuildResult[];
}

export interface JenkinsBuild {
  number: number;
  job: string;
  result: BuildResult;
  startedAt: string;
  durationSec: number;
  branch?: string;
  culprit?: string;
  /** 这次构建用的是哪个 commit（Jenkins 需要安装 git 插件并回写；没有就只能显示"未记录"） */
  commit?: string;
}

export interface JenkinsNode {
  name: string;
  online: boolean;
  executors: number;
  busy: number;
  labels: string;
}

export interface JenkinsSnapshot {
  jobs: JenkinsJob[];
  builds: JenkinsBuild[];
  nodes: JenkinsNode[];
  queue: number;
  note?: string;
}

export interface JenkinsConnection {
  id: string;
  name: string;
  url: string;
  username?: string;
  token?: string;
}

export interface DockerConnection {
  id: string;
  name: string;
  /** 例如 tcp://10.0.0.5:2375、ssh://user@host、npipe:////./pipe/docker_engine；空表示 agent 所在机器的默认引擎 */
  host: string;
}

export interface MysqlConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
}

/* ---------- Prometheus + Grafana ---------- */

export interface PromTarget {
  job: string;
  instance: string;
  health: "up" | "down";
  lastScrape: string;
  scrapeDurationMs: number;
  labels: Record<string, string>;
}

export interface AlertRule {
  name: string;
  severity: "critical" | "warning" | "info";
  state: "firing" | "pending" | "inactive";
  since?: string;
  summary: string;
  value?: string;
}

export interface GrafanaDashboard {
  uid: string;
  title: string;
  folder: string;
  panels: number;
  updatedAt: string;
  url: string;
}

export interface MetricSeries {
  name: string;
  unit: string;
  points: number[];
  labels: Record<string, string>;
  current: number;
  min: number;
  max: number;
  avg: number;
}

export interface ObservabilitySnapshot {
  targets: PromTarget[];
  alerts: AlertRule[];
  dashboards: GrafanaDashboard[];
  series: MetricSeries[];
  scrapeIntervalSec: number;
  note?: string;
}

/* ---------- 可执行动作 ---------- */

/**
 * 允许下发的动作白名单。前端只能从这份清单里选，agent 端也按同一份清单执行，
 * 参数只允许容器名 / 仓库路径 / 流水线名，不接受自由命令行。
 */
export type ActionId = "docker.restart" | "docker.start" | "docker.stop" | "git.fetch" | "git.pull" | "jenkins.build";

export interface ActionRequest {
  action: ActionId;
  target: string;
}

/** agent 执行完返回的结果；演示模式为模拟结果（simulated 为 true）。 */
export interface ActionOutcome {
  action: ActionId;
  command: string;
  ok: boolean;
  simulated: boolean;
  output: string;
  error: string;
  durationMs: number;
  at: string;
}

/* ---------- 数据源客户端 ---------- */

export type ClientMode = "demo" | "agent";

export interface DevopsClient {
  mode: ClientMode;
  sources(): Promise<SourceState[]>;
  docker(connection?: DockerConnection): Promise<DockerSnapshot>;
  mysql(connection?: MysqlConnection): Promise<MysqlSnapshot>;
  terraform(): Promise<TerraformSnapshot>;
  ansible(): Promise<AnsibleSnapshot>;
  git(): Promise<GitSnapshot>;
  jenkins(connection?: JenkinsConnection): Promise<JenkinsSnapshot>;
  observability(): Promise<ObservabilitySnapshot>;
  /** 执行白名单内的动作；agent 模式要求设置里填了执行令牌。 */
  execute(request: ActionRequest): Promise<ActionOutcome>;
}

/* ---------- 设置 ---------- */

export interface Settings {
  mode: ClientMode;
  agentUrl: string;
  /** agent 启动时打印的执行令牌，只存在本机浏览器里；空表示不允许下发 */
  agentToken: string;
  env: EnvName;
  /** 用不到的模块默认不显示在侧栏，可在设置里打开 */
  modules: {
    terraform: boolean;
    ansible: boolean;
  };
  endpoints: {
    docker: string;
    mysql: string;
    terraform: string;
    ansible: string;
    jenkins: string;
    prometheus: string;
    grafana: string;
  };
}
