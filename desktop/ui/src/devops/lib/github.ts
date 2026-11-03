/**
 * GitHub 只读客户端。
 *
 * 工作台的 Git 模块不 clone、不推送，只按需读 GitHub 的 REST API：
 * 仓库元信息、提交、分支、目录内容与 README。公开仓库不需要令牌，
 * 有令牌时还能读自己的私有库，速率上限也从 60 次/小时提到 5000 次/小时。
 */

export const GITHUB_API = "https://api.github.com";
export const REPO_STORAGE_KEY = "qingshan.workbench.github.repos";

export interface RepoRef {
  owner: string;
  name: string;
}

export interface SavedRepo extends RepoRef {
  kind: "own" | "public";
  addedAt: string;
}

export interface GithubRepo extends RepoRef {
  fullName: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  language: string | null;
  topics: string[];
  defaultBranch: string;
  updatedAt: string;
  pushedAt: string | null;
  htmlUrl: string;
  homepage: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number;
}

export interface GithubCommit {
  sha: string;
  short: string;
  message: string;
  author: string;
  authorLogin: string | null;
  avatarUrl: string | null;
  date: string;
  htmlUrl: string;
}

export interface GithubBranch {
  name: string;
  isDefault: boolean;
  sha: string;
  protected: boolean;
}

export interface GithubEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "submodule";
  size: number;
  sha: string;
}

export interface GithubFile {
  path: string;
  text: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  htmlUrl: string;
}

export interface GithubTree {
  entries: GithubEntry[];
  file: GithubFile | null;
}

export interface GithubReleaseAsset {
  name: string;
  size: number;
  downloadCount: number;
  contentType: string;
  browserDownloadUrl: string;
}

export interface GithubRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string;
  htmlUrl: string;
  assets: GithubReleaseAsset[];
}

export interface GithubRate {
  limit: number;
  remaining: number;
  resetAt: string;
}

export type GithubErrorKind = "auth" | "notfound" | "rate" | "network" | "unknown";

export class GithubError extends Error {
  kind: GithubErrorKind;
  status: number;
  hint: string;

  constructor(kind: GithubErrorKind, message: string, hint: string, status = 0) {
    super(message);
    this.name = "GithubError";
    this.kind = kind;
    this.hint = hint;
    this.status = status;
  }
}

export interface GithubApi {
  repo(ref: RepoRef): Promise<GithubRepo>;
  commits(ref: RepoRef, branch: string, limit?: number): Promise<GithubCommit[]>;
  branches(ref: RepoRef): Promise<GithubBranch[]>;
  contents(ref: RepoRef, path: string, branch: string): Promise<GithubTree>;
  readme(ref: RepoRef, branch: string): Promise<GithubFile | null>;
  releases(ref: RepoRef, limit?: number): Promise<GithubRelease[]>;
  rate(): Promise<GithubRate | null>;
}

/* ------------------------------------------------------------------ */
/* 输入解析与存储                                                       */
/* ------------------------------------------------------------------ */

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * 接受各种写法：`owner/repo`、`https://github.com/owner/repo`、
 * `https://github.com/owner/repo/tree/main/src`、`git@github.com:owner/repo.git`、
 * `ssh://git@github.com/owner/repo.git`、`github.com/owner/repo`。
 * 解析不出来就返回 null，避免把半截字符串当仓库名发请求。
 */
export function parseRepoRef(input: string): RepoRef | null {
  let text = input.trim().replace(/^[<("'\[]+|[>)"'\]]+$/g, "");
  if (!text) return null;
  if (/^(https?:\/\/|ssh:\/\/|git@|git:\/\/)/i.test(text) && !/github\.com/i.test(text)) return null;
  text = text.replace(/^(https?:\/\/|ssh:\/\/|git:\/\/)?(git@)?(www\.)?github\.com[:/]/i, "");
  text = text.replace(/[?#].*$/, "");
  text = text.replace(/\/+$/, "");
  const parts = text.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts;
  const clean = name.replace(/\.git$/i, "");
  if (!OWNER_PATTERN.test(owner) || !NAME_PATTERN.test(clean)) return null;
  if (clean === "." || clean === "..") return null;
  return { owner, name: clean };
}

/**
 * 一次粘贴多条链接时用：按空白、逗号、分号、换行切开，逐条解析并去重。
 * 返回解析成功的仓库和解析失败的原文，方便提示「忽略了哪几条」。
 */
export function parseRepoRefs(input: string): { refs: RepoRef[]; invalid: string[] } {
  const refs: RepoRef[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const chunk of input.split(/[\s,;，；]+/)) {
    const piece = chunk.trim();
    if (!piece) continue;
    const ref = parseRepoRef(piece);
    if (!ref) {
      invalid.push(piece);
      continue;
    }
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return { refs, invalid };
}

export function refKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`.toLowerCase();
}

export function fullName(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}

export function loadSavedRepos(): SavedRepo[] {
  try {
    const raw = localStorage.getItem(REPO_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: SavedRepo[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.owner !== "string" || typeof record.name !== "string") continue;
      if (!OWNER_PATTERN.test(record.owner) || !NAME_PATTERN.test(record.name)) continue;
      const ref = { owner: record.owner, name: record.name };
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        ...ref,
        kind: record.kind === "own" ? "own" : "public",
        addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date().toISOString(),
      });
    }
    return result;
  } catch {
    return [];
  }
}

export function saveSavedRepos(repos: SavedRepo[]): void {
  try {
    localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(repos));
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

export function addSavedRepo(repos: SavedRepo[], ref: RepoRef, kind: SavedRepo["kind"]): SavedRepo[] {
  const key = refKey(ref);
  if (repos.some((item) => refKey(item) === key)) return repos;
  return [...repos, { owner: ref.owner, name: ref.name, kind, addedAt: new Date().toISOString() }];
}

export function removeSavedRepo(repos: SavedRepo[], key: string): SavedRepo[] {
  return repos.filter((item) => refKey(item) !== key.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* 真实客户端                                                           */
/* ------------------------------------------------------------------ */

function decodeBase64(content: string): { text: string; binary: boolean } {
  const clean = content.replace(/\n/g, "");
  try {
    const binary = atob(clean);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.includes(0)) return { text: "", binary: true };
    return { text: new TextDecoder().decode(bytes), binary: false };
  } catch {
    return { text: "", binary: true };
  }
}

function mapRepo(raw: Record<string, unknown>): GithubRepo {
  const owner = (raw.owner as Record<string, unknown> | undefined)?.login;
  const name = String(raw.name ?? "");
  return {
    owner: String(owner ?? ""),
    name,
    fullName: String(raw.full_name ?? `${owner}/${name}`),
    description: (raw.description as string | null) ?? null,
    private: raw.private === true,
    fork: raw.fork === true,
    archived: raw.archived === true,
    stars: Number(raw.stargazers_count ?? 0),
    forks: Number(raw.forks_count ?? 0),
    openIssues: Number(raw.open_issues_count ?? 0),
    watchers: Number(raw.subscribers_count ?? raw.watchers_count ?? 0),
    language: (raw.language as string | null) ?? null,
    topics: Array.isArray(raw.topics) ? raw.topics.map((topic) => String(topic)) : [],
    defaultBranch: String(raw.default_branch ?? "main"),
    updatedAt: String(raw.updated_at ?? ""),
    pushedAt: (raw.pushed_at as string | null) ?? null,
    htmlUrl: String(raw.html_url ?? ""),
    homepage: (raw.homepage as string | null) ?? null,
  };
}

function mapCommit(raw: Record<string, unknown>): GithubCommit {
  const commit = (raw.commit as Record<string, unknown>) ?? {};
  const message = String(commit.message ?? "");
  const author = (raw.author as Record<string, unknown> | null) ?? null;
  const sha = String(raw.sha ?? "");
  return {
    sha,
    short: sha.slice(0, 7),
    message,
    author: String((commit.author as Record<string, unknown> | undefined)?.name ?? "未知"),
    authorLogin: author ? String(author.login ?? "") : null,
    avatarUrl: author ? String(author.avatar_url ?? "") : null,
    date: String((commit.author as Record<string, unknown> | undefined)?.date ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
  };
}

function mapFile(raw: Record<string, unknown>): GithubFile {
  const encoded = typeof raw.content === "string" ? raw.content : "";
  const decoded = encoded ? decodeBase64(encoded) : { text: "", binary: false };
  return {
    path: String(raw.path ?? ""),
    text: decoded.text,
    size: Number(raw.size ?? 0),
    binary: decoded.binary,
    truncated: encoded === "" && Number(raw.size ?? 0) > 0,
    htmlUrl: String(raw.html_url ?? ""),
  };
}

function mapRelease(raw: Record<string, unknown>): GithubRelease {
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  return {
    id: Number(raw.id ?? 0),
    tagName: String(raw.tag_name ?? ""),
    name: String(raw.name ?? raw.tag_name ?? ""),
    body: String(raw.body ?? ""),
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    publishedAt: String(raw.published_at ?? raw.created_at ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
    assets: assets.map((item) => {
      const asset = (item ?? {}) as Record<string, unknown>;
      return {
        name: String(asset.name ?? ""),
        size: Number(asset.size ?? 0),
        downloadCount: Number(asset.download_count ?? 0),
        contentType: String(asset.content_type ?? ""),
        browserDownloadUrl: String(asset.browser_download_url ?? ""),
      };
    }),
  };
}

function errorFor(status: number, payload: unknown): GithubError {
  const message =
    typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).message === "string"
      ? String((payload as Record<string, unknown>).message)
      : `GitHub 返回 ${status}`;
  if (status === 401) {
    return new GithubError("auth", "GitHub 拒绝了这次请求", "这个接口现在只读公开仓库，不需要账号；确认链接是公开仓库，稍后再试。", status);
  }
  if (status === 404) {
    return new GithubError("notfound", "仓库不存在，或不是公开仓库", "检查 owner/repo 是否拼错；私有仓库这里读不到。", status);
  }
  if (status === 403 || status === 429) {
    return new GithubError(
      "rate",
      "GitHub 接口调用次数用完了",
      "未登录时每个 IP 每小时 60 次，等到整点重置再刷新；少开几个仓库详情也能省调用。",
      status,
    );
  }
  return new GithubError("unknown", message, "看看 GitHub 状态页，或者稍后重试。", status);
}

export interface GithubRequestOptions {
  query?: Record<string, string | number | undefined>;
}

export function createGithubApi(fetchImpl: typeof fetch = globalThis.fetch): GithubApi {
  async function request<T>(path: string, options: GithubRequestOptions = {}): Promise<T> {
    const url = new URL(`${GITHUB_API}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { headers });
    } catch {
      throw new GithubError("network", "连不上 api.github.com", "确认这台机器能访问 GitHub，或者代理是否放行了 api.github.com。", 0);
    }
    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw errorFor(response.status, payload);
    }
    return (await response.json()) as T;
  }

  return {
    async repo(ref) {
      const raw = await request<Record<string, unknown>>(`/repos/${ref.owner}/${ref.name}`);
      return mapRepo(raw);
    },

    async commits(ref, branch, limit = 30) {
      const raw = await request<Record<string, unknown>[]>(`/repos/${ref.owner}/${ref.name}/commits`, {
        query: { sha: branch, per_page: limit },
      });
      return raw.map(mapCommit);
    },

    async branches(ref) {
      const raw = await request<Record<string, unknown>[]>(`/repos/${ref.owner}/${ref.name}/branches`, {
        query: { per_page: 100 },
      });
      return raw.map((item) => ({
        name: String(item.name ?? ""),
        isDefault: false,
        sha: String((item.commit as Record<string, unknown> | undefined)?.sha ?? ""),
        protected: item.protected === true,
      }));
    },

    async contents(ref, path, branch) {
      const encoded = path
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const suffix = encoded ? `/${encoded}` : "";
      const raw = await request<Record<string, unknown> | Record<string, unknown>[]>(
        `/repos/${ref.owner}/${ref.name}/contents${suffix}`,
        { query: { ref: branch } },
      );
      if (Array.isArray(raw)) {
        const entries: GithubEntry[] = raw.map((item) => ({
          name: String(item.name ?? ""),
          path: String(item.path ?? ""),
          type: item.type === "dir" ? "dir" : item.type === "submodule" ? "submodule" : "file",
          size: Number(item.size ?? 0),
          sha: String(item.sha ?? ""),
        }));
        entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
        return { entries, file: null };
      }
      return { entries: [], file: mapFile(raw) };
    },

    async readme(ref, branch) {
      try {
        const raw = await request<Record<string, unknown>>(`/repos/${ref.owner}/${ref.name}/readme`, {
          query: { ref: branch },
        });
        return mapFile(raw);
      } catch (error) {
        if (error instanceof GithubError && error.kind === "notfound") return null;
        throw error;
      }
    },

    async releases(ref, limit = 20) {
      const raw = await request<Record<string, unknown>[]>(`/repos/${ref.owner}/${ref.name}/releases`, {
        query: { per_page: limit },
      });
      return raw.map(mapRelease);
    },

    async rate() {
      try {
        const raw = await request<Record<string, unknown>>("/rate_limit");
        const core = (raw.resources as Record<string, unknown> | undefined)?.core as Record<string, unknown> | undefined;
        if (!core) return null;
        return {
          limit: Number(core.limit ?? 0),
          remaining: Number(core.remaining ?? 0),
          resetAt: new Date(Number(core.reset ?? 0) * 1000).toISOString(),
        };
      } catch {
        return null;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* 演示客户端                                                           */
/* ------------------------------------------------------------------ */

interface DemoRepoData {
  repo: GithubRepo;
  commits: GithubCommit[];
  branches: GithubBranch[];
  tree: Record<string, GithubTree>;
  readme: GithubFile | null;
}

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => hoursAgo(days * 24);

function demoRepo(
  owner: string,
  name: string,
  extra: Partial<GithubRepo> & Pick<GithubRepo, "description" | "stars" | "forks" | "language">,
): GithubRepo {
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    private: false,
    fork: false,
    archived: false,
    openIssues: 4,
    watchers: 12,
    topics: [],
    defaultBranch: "main",
    updatedAt: hoursAgo(3),
    pushedAt: hoursAgo(3),
    htmlUrl: `https://github.com/${owner}/${name}`,
    homepage: null,
    ...extra,
  };
}

function demoCommits(prefix: string, messages: string[], author: string, avatarUrl: string | null): GithubCommit[] {
  return messages.map((message, index) => {
    const seed = `${prefix}${(index + 1).toString(16)}`;
    const sha = (seed + "0123456789abcdef".repeat(3)).slice(0, 40);
    return {
      sha,
      short: sha.slice(0, 7),
      message,
      author,
      authorLogin: author.toLowerCase().replace(/\s+/g, "-"),
      avatarUrl,
      date: hoursAgo(index * 7 + 2),
      htmlUrl: `https://github.com/qingshan/api/commit/${sha.slice(0, 7)}`,
    };
  });
}

function demoFile(path: string, text: string, htmlUrl = `https://github.com/qingshan/api/blob/main/${path}`): GithubFile {
  return { path, text, size: new TextEncoder().encode(text).length, binary: false, truncated: false, htmlUrl };
}

/* 贴进来的常见公开库：给个像样的元信息，其它内容仍然标明是演示数据 */
interface PopularEntry {
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string;
  defaultBranch: string;
  topics: string[];
}

const POPULAR_REPOS: Record<string, PopularEntry> = {
  "rust-lang/rust": {
    description: "Empowering everyone to build reliable and efficient software.",
    stars: 101_000,
    forks: 12_800,
    openIssues: 10_400,
    language: "Rust",
    defaultBranch: "master",
    topics: ["compiler", "language", "rust"],
  },
  "vuejs/core": {
    description: "Vue.js 的渐进式、可增量采用的 JavaScript 框架。",
    stars: 49_300,
    forks: 8_600,
    openIssues: 580,
    language: "TypeScript",
    defaultBranch: "main",
    topics: ["vue", "framework"],
  },
  "facebook/react": {
    description: "The library for web and native user interfaces.",
    stars: 232_000,
    forks: 47_600,
    openIssues: 780,
    language: "JavaScript",
    defaultBranch: "main",
    topics: ["react", "ui"],
  },
  "microsoft/vscode": {
    description: "Visual Studio Code.",
    stars: 166_000,
    forks: 29_800,
    openIssues: 9_200,
    language: "TypeScript",
    defaultBranch: "main",
    topics: ["editor", "electron"],
  },
  "kubernetes/kubernetes": {
    description: "Production-Grade Container Scheduling and Management",
    stars: 112_000,
    forks: 39_900,
    openIssues: 1_900,
    language: "Go",
    defaultBranch: "master",
    topics: ["kubernetes", "containers"],
  },
  "docker/compose": {
    description: "Define and run multi-container applications with Docker",
    stars: 34_600,
    forks: 5_300,
    openIssues: 420,
    language: "Go",
    defaultBranch: "main",
    topics: ["docker", "compose"],
  },
  "prometheus/prometheus": {
    description: "The Prometheus monitoring system and time series database.",
    stars: 56_800,
    forks: 9_200,
    openIssues: 720,
    language: "Go",
    defaultBranch: "main",
    topics: ["monitoring", "metrics"],
  },
  "jenkinsci/jenkins": {
    description: "Jenkins automation server",
    stars: 23_900,
    forks: 8_800,
    openIssues: 2_400,
    language: "Java",
    defaultBranch: "master",
    topics: ["ci", "automation"],
  },
  "ansible/ansible": {
    description: "Ansible is a radically simple IT automation platform.",
    stars: 63_600,
    forks: 24_000,
    openIssues: 830,
    language: "Python",
    defaultBranch: "devel",
    topics: ["automation", "configuration-management"],
  },
  "hashicorp/terraform": {
    description: "Terraform enables you to safely and predictably create, change, and improve infrastructure.",
    stars: 43_700,
    forks: 9_600,
    openIssues: 2_100,
    language: "Go",
    defaultBranch: "main",
    topics: ["terraform", "infrastructure"],
  },
};

function popularRepo(ref: RepoRef): DemoRepoData | null {
  const entry = POPULAR_REPOS[refKey(ref)];
  if (!entry) return null;

  const repo = demoRepo(ref.owner, ref.name, {
    description: entry.description,
    stars: entry.stars,
    forks: entry.forks,
    openIssues: entry.openIssues,
    language: entry.language,
    topics: entry.topics,
    defaultBranch: entry.defaultBranch,
    updatedAt: hoursAgo(5),
    pushedAt: hoursAgo(5),
  });

  const base = `https://github.com/${repo.fullName}`;
  const commits = demoCommits(
    ref.name,
    [
      "Merge pull request #18204 from dependabot/npm_and_yarn/dev",
      "fix: 修正边界条件上的回归",
      "docs: 补一段使用说明",
      "chore(deps): bump minor dependencies",
      "refactor: 收敛重复的错误处理",
      "test: 补一条集成用例",
    ],
    "GitHub",
    null,
  ).map((commit) => ({ ...commit, htmlUrl: `${base}/commit/${commit.short}` }));

  const readmeText = `# ${ref.name}

${entry.description}

> 演示模式：这里的提交、目录与 README 都是按仓库名生成的样例。切到「本地 agent」后，
> 读的是 GitHub 上的真实公开内容（未登录每小时 60 次）。

## 安装

\`\`\`bash
git clone ${base}.git
\`\`\`

## 目录

- 源码在仓库根目录
- 文档与示例见 \`docs/\`
- 参与贡献前先读 \`CONTRIBUTING.md\`

## 许可

See [LICENSE](${base}/blob/${entry.defaultBranch}/LICENSE).
`;

  const readmeFile = demoFile("README.md", readmeText, `${base}/blob/${entry.defaultBranch}/README.md`);

  return {
    repo,
    commits,
    branches: [
      { name: entry.defaultBranch, isDefault: true, sha: commits[0].sha, protected: true },
      { name: "next", isDefault: false, sha: commits[1].sha, protected: false },
      { name: "release", isDefault: false, sha: commits[2].sha, protected: true },
    ],
    tree: {
      "": {
        entries: [
          { name: "src", path: "src", type: "dir", size: 0, sha: "p1" },
          { name: "docs", path: "docs", type: "dir", size: 0, sha: "p2" },
          { name: "README.md", path: "README.md", type: "file", size: new TextEncoder().encode(readmeText).length, sha: "p3" },
          { name: "LICENSE", path: "LICENSE", type: "file", size: 1_068, sha: "p4" },
        ],
        file: null,
      },
      "src": {
        entries: [{ name: "index.ts", path: "src/index.ts", type: "file", size: 3_214, sha: "p5" }],
        file: null,
      },
      "docs": {
        entries: [{ name: "guide.md", path: "docs/guide.md", type: "file", size: 5_120, sha: "p6" }],
        file: null,
      },
      "README.md": { entries: [], file: readmeFile },
      "LICENSE": {
        entries: [],
        file: demoFile("LICENSE", "MIT License\n\nCopyright (c) the project authors\n", `${base}/blob/${entry.defaultBranch}/LICENSE`),
      },
      "src/index.ts": {
        entries: [],
        file: demoFile("src/index.ts", "export function hello(name: string): string {\n  return `hello ${name}`;\n}\n", `${base}/blob/${entry.defaultBranch}/src/index.ts`),
      },
      "docs/guide.md": {
        entries: [],
        file: demoFile("docs/guide.md", `# Guide\n\n${entry.description}\n`, `${base}/blob/${entry.defaultBranch}/docs/guide.md`),
      },
    },
    readme: readmeFile,
  };
}

const API_README = `# 青衫 API

订单、库存与结算的 HTTP 接口，跑在 Kubernetes 上，镜像由 Jenkins 构建。

## 本地运行

\`\`\`bash
npm ci
npm run dev   # 8080
\`\`\`

## 目录

- \`src/routes\` 路由与参数校验
- \`src/tasks\` 定时任务（对账、导出）
- \`docs/\` 接口文档与变更记录

## 约定

1. 所有对外接口都要有 \`requestId\`
2. 数据库迁移必须可回滚
3. 时区统一用 UTC，展示层再转

> 发布前跑一遍 \`npm run test:e2e\`，构建会卡在冒烟用例上。
`;

function buildDemoRepos(): DemoRepoData[] {
  const apiRepo = demoRepo("qingshan", "api", {
    description: "订单、库存与结算的 HTTP 接口",
    stars: 128,
    forks: 24,
    openIssues: 6,
    language: "TypeScript",
    topics: ["node", "fastify", "orders"],
    updatedAt: hoursAgo(2),
    pushedAt: hoursAgo(2),
  });
  const apiCommits = demoCommits(
    "b71e0d",
    [
      "fix(api): 修正订单导出时区偏移",
      "feat(orders): 支持按渠道筛选",
      "chore(deps): 升级 fastify 到 5.2.0",
      "refactor(tasks): 对账任务拆成可重试步骤",
      "fix(db): 连接池上限提到 40",
      "docs: 补接口变更记录",
      "feat(settlement): 增加结算预览",
      "test: 补导出相关用例",
    ],
    "青衫",
    null,
  );
  const apiTree: Record<string, GithubTree> = {
    "": {
      entries: [
        { name: "src", path: "src", type: "dir", size: 0, sha: "t1" },
        { name: "docs", path: "docs", type: "dir", size: 0, sha: "t2" },
        { name: "Dockerfile", path: "Dockerfile", type: "file", size: 412, sha: "f1" },
        { name: "package.json", path: "package.json", type: "file", size: 1_284, sha: "f2" },
        { name: "README.md", path: "README.md", type: "file", size: 1_920, sha: "f3" },
      ],
      file: null,
    },
    src: {
      entries: [
        { name: "routes", path: "src/routes", type: "dir", size: 0, sha: "t3" },
        { name: "tasks", path: "src/tasks", type: "dir", size: 0, sha: "t4" },
        { name: "server.ts", path: "src/server.ts", type: "file", size: 2_310, sha: "f4" },
      ],
      file: null,
    },
    "package.json": {
      entries: [],
      file: demoFile(
        "package.json",
        `{
  "name": "@qingshan/api",
  "version": "1.14.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "test:e2e": "vitest run --config vitest.e2e.ts"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
  }
}
`,
      ),
    },
    "README.md": { entries: [], file: demoFile("README.md", API_README) },
  };

  const webRepo = demoRepo("qingshan", "web-console", {
    description: "控制台前端：发布、监控与工单",
    stars: 42,
    forks: 8,
    openIssues: 3,
    language: "TypeScript",
    topics: ["react", "vite"],
    updatedAt: daysAgo(1),
    pushedAt: daysAgo(1),
  });

  const nextRepo = demoRepo("vercel", "next.js", {
    description: "The React Framework",
    stars: 128_412,
    forks: 27_336,
    openIssues: 2_104,
    language: "JavaScript",
    topics: ["react", "framework", "ssr"],
    defaultBranch: "canary",
    updatedAt: hoursAgo(1),
    pushedAt: hoursAgo(1),
  });
  const nextCommits = demoCommits(
    "9ac83e",
    ["v15.1.4", "fix: 修正 app router 的缓存失效", "docs: 更新部署示例", "chore: 同步 canary 分支"],
    "Sebastian Markbåge",
    null,
  );
  const nextTree: Record<string, GithubTree> = {
    "": {
      entries: [
        { name: "packages", path: "packages", type: "dir", size: 0, sha: "n1" },
        { name: "examples", path: "examples", type: "dir", size: 0, sha: "n2" },
        { name: "docs", path: "docs", type: "dir", size: 0, sha: "n3" },
        { name: "package.json", path: "package.json", type: "file", size: 3_920, sha: "n4" },
        { name: "README.md", path: "README.md", type: "file", size: 5_120, sha: "n5" },
      ],
      file: null,
    },
    "README.md": {
      entries: [],
      file: demoFile(
        "README.md",
        `# Next.js

The React Framework for the Web.

## 开始

\`\`\`bash
npx create-next-app@latest
\`\`\`

## 文档

- [快速上手](https://nextjs.org/docs)
- [示例仓库](https://github.com/vercel/next.js/tree/canary/examples)

## 许可

MIT
`,
        "https://github.com/vercel/next.js/blob/canary/README.md",
      ),
    },
  };

  return [
    {
      repo: apiRepo,
      commits: apiCommits,
      branches: [
        { name: "main", isDefault: true, sha: apiCommits[0].sha, protected: true },
        { name: "feat/order-export", isDefault: false, sha: "c3f8a1d0", protected: false },
        { name: "fix/timezone", isDefault: false, sha: "a0c19e77", protected: false },
      ],
      tree: apiTree,
      readme: apiTree["README.md"].file,
    },
    {
      repo: webRepo,
      commits: demoCommits("77c1a9", ["feat(console): 发布链支持一键重试", "style: 侧栏间距微调", "fix: 深色下表格斑马纹"], "林可", null),
      branches: [
        { name: "main", isDefault: true, sha: "77c1a900", protected: true },
        { name: "feat/release-retry", isDefault: false, sha: "77c1a901", protected: false },
      ],
      tree: {
        "": {
          entries: [
            { name: "src", path: "src", type: "dir", size: 0, sha: "w1" },
            { name: "package.json", path: "package.json", type: "file", size: 1_102, sha: "w2" },
          ],
          file: null,
        },
      },
      readme: null,
    },
    {
      repo: nextRepo,
      commits: nextCommits,
      branches: [
        { name: "canary", isDefault: true, sha: nextCommits[0].sha, protected: true },
        { name: "v15.1.4", isDefault: false, sha: nextCommits[0].sha, protected: true },
      ],
      tree: nextTree,
      readme: nextTree["README.md"].file,
    },
  ];
}

export function createDemoGithub(): GithubApi {
  const data = buildDemoRepos();
  const find = (ref: RepoRef) => data.find((item) => refKey(item.repo) === refKey(ref));
  const delay = () => new Promise((resolve) => setTimeout(resolve, 140 + Math.random() * 220));

  const synth = (ref: RepoRef): DemoRepoData =>
    popularRepo(ref) ?? {
      repo: demoRepo(ref.owner, ref.name, {
        description: "演示模式没有这个仓库的样例数据，切到真实数据后就能读到真实内容。",
        stars: 0,
        forks: 0,
        openIssues: 0,
        language: null,
        defaultBranch: "main",
      }),
      commits: [],
      branches: [{ name: "main", isDefault: true, sha: "", protected: false }],
      tree: { "": { entries: [], file: null } },
      readme: null,
    };

  return {
    async repo(ref) {
      await delay();
      return (find(ref) ?? synth(ref)).repo;
    },

    async commits(ref, _branch, limit = 30) {
      await delay();
      return (find(ref) ?? synth(ref)).commits.slice(0, limit);
    },

    async branches(ref) {
      await delay();
      const entry = find(ref) ?? synth(ref);
      const fallback = entry.repo.defaultBranch;
      return entry.branches.map((branch) => ({ ...branch, isDefault: branch.name === fallback }));
    },

    async contents(ref, path, _branch) {
      await delay();
      const entry = find(ref) ?? synth(ref);
      const key = path.replace(/^\/+|\/+$/g, "");
      return entry.tree[key] ?? { entries: [], file: null };
    },

    async readme(ref) {
      await delay();
      return (find(ref) ?? synth(ref)).readme;
    },

    async releases(ref) {
      await delay();
      const entry = find(ref);
      if (!entry) return [];
      const base = entry.repo.fullName;
      return [
        {
          id: 1,
          tagName: "v1.0.0",
          name: "v1.0.0 · 首个正式版",
          body: "桌面端首个正式版，包含诊断、日志、清理、软件清单与更新检查。",
          draft: false,
          prerelease: false,
          publishedAt: new Date(now - 3 * 24 * 3_600_000).toISOString(),
          htmlUrl: `https://github.com/${base}/releases/tag/v1.0.0`,
          assets: [
            {
              name: "QingshanToolbox-v1.0.0-win-x64.zip",
              size: 3_642_352,
              downloadCount: 128,
              contentType: "application/zip",
              browserDownloadUrl: `https://github.com/${base}/releases/download/v1.0.0/QingshanToolbox-v1.0.0-win-x64.zip`,
            },
            {
              name: "SHA256SUMS.txt",
              size: 275,
              downloadCount: 64,
              contentType: "text/plain",
              browserDownloadUrl: `https://github.com/${base}/releases/download/v1.0.0/SHA256SUMS.txt`,
            },
          ],
        },
      ];
    },

    async rate() {
      return { limit: 60, remaining: Math.max(60 - 13, 0), resetAt: new Date(now + 26 * 60_000).toISOString() };
    },
  };
}

export function createGithub(demo: boolean): GithubApi {
  return demo ? createDemoGithub() : createGithubApi();
}

export function repoError(error: unknown): { message: string; hint: string } {
  if (error instanceof GithubError) return { message: error.message, hint: error.hint };
  if (error instanceof Error) return { message: error.message, hint: "稍后重试，或换一个仓库看看。" };
  return { message: "未知错误", hint: "稍后重试。" };
}
