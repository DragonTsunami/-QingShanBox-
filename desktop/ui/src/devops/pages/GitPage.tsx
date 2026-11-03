import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "antd";
import type {
  GithubBranch,
  GithubCommit,
  GithubFile,
  GithubRate,
  GithubRelease,
  GithubRepo,
  GithubTree,
  SavedRepo,
} from "../lib/github";
import {
  addSavedRepo,
  createGithub,
  fullName,
  loadSavedRepos,
  parseRepoRefs,
  refKey,
  removeSavedRepo,
  repoError,
  saveSavedRepos,
} from "../lib/github";
import { parseInline, parseMarkdown } from "../lib/markdown";
import type { Block, Inline } from "../lib/markdown";
import { relTime } from "../lib/format";
import type { PageProps } from "../lib/page";
import { Banner, Badge, Card, DataTable, Empty, Loading, Tabs } from "../components/ui";
import { Icon } from "../components/Icons";
import { showToast } from "../components/toast";

type Loadable<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; message: string };

const EMPTY_TREE: GithubTree = { entries: [], file: null };
const GITHUB_REFRESH_KEY = "qingshan.workbench.github.refresh";
const GITHUB_REFRESH_OPTIONS = [60, 180, 300, 600] as const;

function loadGithubRefresh(): number {
  try {
    const value = Number(localStorage.getItem(GITHUB_REFRESH_KEY));
    return GITHUB_REFRESH_OPTIONS.includes(value as (typeof GITHUB_REFRESH_OPTIONS)[number]) ? value : 180;
  } catch {
    return 180;
  }
}

function saveGithubRefresh(value: number): void {
  try {
    localStorage.setItem(GITHUB_REFRESH_KEY, String(value));
  } catch {
    /* 隐私模式忽略 */
  }
}

function GithubRefreshSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="gh-refresh">
      <span className="small dim">自动刷新</span>
      <select className="select tiny" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {GITHUB_REFRESH_OPTIONS.map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds / 60} 分钟
          </option>
        ))}
      </select>
    </label>
  );
}

function fmtCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")} 万`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function repoFromSaved(item: SavedRepo): GithubRepo {
  return {
    owner: item.owner,
    name: item.name,
    fullName: fullName(item),
    description: null,
    private: false,
    fork: false,
    archived: false,
    stars: 0,
    forks: 0,
    openIssues: 0,
    watchers: 0,
    language: null,
    topics: [],
    defaultBranch: "main",
    updatedAt: item.addedAt,
    pushedAt: null,
    htmlUrl: `https://github.com/${fullName(item)}`,
    homepage: null,
  };
}

export function GitPage({ settings }: PageProps) {
  // GitHub 页面本身就是远程只读数据源，始终走真实 API。
  // 演示模式只影响本地监控数据，不能让公共仓库退化成“只有分支”的样例壳。
  const api = useMemo(() => createGithub(false), []);

  const [repos, setRepos] = useState<SavedRepo[]>(() => loadSavedRepos());
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, Loadable<GithubRepo>>>({});
  const [rate, setRate] = useState<GithubRate | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<number>(loadGithubRefresh);

  const [detail, setDetail] = useState<Loadable<GithubRepo> | null>(null);
  const [commits, setCommits] = useState<Loadable<GithubCommit[]>>({ status: "loading" });
  const [branches, setBranches] = useState<Loadable<GithubBranch[]>>({ status: "loading" });
  const [releases, setReleases] = useState<Loadable<GithubRelease[]>>({ status: "loading" });
  const [readme, setReadme] = useState<Loadable<GithubFile | null>>({ status: "loading" });
  const [branch, setBranch] = useState("");
  const [tab, setTab] = useState("commits");
  const [path, setPath] = useState("");
  const [tree, setTree] = useState<Loadable<GithubTree>>({ status: "loading" });
  const [reloadAt, setReloadAt] = useState(0);

  const requested = useRef(new Set<string>());

  useEffect(() => {
    saveGithubRefresh(autoRefreshSeconds);
  }, [autoRefreshSeconds]);

  useEffect(() => {
    let alive = true;
    api
      .rate()
      .then((value) => {
        if (alive) setRate(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, reloadAt]);

  /* 列表卡片：逐个取仓库元信息，失败只影响这一张卡 */
  useEffect(() => {
    for (const item of repos) {
      const key = refKey(item);
      if (requested.current.has(key) && reloadAt === 0) continue;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      setMetas((prev) => ({ ...prev, [key]: { status: "loading" } }));
      api
        .repo(item)
        .then((repo) => setMetas((prev) => ({ ...prev, [key]: { status: "ready", value: repo } })))
        .catch((error) => {
          const info = repoError(error);
          setMetas((prev) => ({ ...prev, [key]: { status: "error", message: info.message } }));
        });
    }
  }, [api, repos]);

  const selectedRepo = useMemo(() => repos.find((item) => refKey(item) === selected) ?? null, [repos, selected]);

  /* 详情：仓库、提交、分支、README 一起拉 */
  useEffect(() => {
    if (!selectedRepo) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail({ status: "loading" });
    setBranch("");
    setPath("");
    setTab("commits");

    const load = async () => {
      try {
        const repo = await api.repo(selectedRepo);
        if (!alive) return;
        setDetail({ status: "ready", value: repo });
        setBranch(repo.defaultBranch);
      } catch (error) {
        if (alive) setDetail({ status: "error", message: repoError(error).message });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [api, selectedRepo, reloadAt]);

  useEffect(() => {
    if (!selectedRepo || !branch) return;
    let alive = true;
    setCommits({ status: "loading" });
    setReadme({ status: "loading" });
    setBranches({ status: "loading" });
    setReleases({ status: "loading" });

    api
      .commits(selectedRepo, branch, 30)
      .then((value) => alive && setCommits({ status: "ready", value }))
      .catch((error) => alive && setCommits({ status: "error", message: repoError(error).message }));
    api
      .branches(selectedRepo)
      .then((value) => alive && setBranches({ status: "ready", value }))
      .catch((error) => alive && setBranches({ status: "error", message: repoError(error).message }));
    api
      .readme(selectedRepo, branch)
      .then((value) => alive && setReadme({ status: "ready", value }))
      .catch((error) => alive && setReadme({ status: "error", message: repoError(error).message }));
    api
      .releases(selectedRepo)
      .then((value) => alive && setReleases({ status: "ready", value }))
      .catch((error) => alive && setReleases({ status: "error", message: repoError(error).message }));

    setTree({ status: "ready", value: EMPTY_TREE });
    return () => {
      alive = false;
    };
  }, [api, selectedRepo, branch, reloadAt]);

  useEffect(() => {
    if (!selectedRepo || !branch || tab !== "files") return;
    let alive = true;
    setTree({ status: "loading" });
    api
      .contents(selectedRepo, path, branch)
      .then((value) => alive && setTree({ status: "ready", value }))
      .catch((error) => alive && setTree({ status: "error", message: repoError(error).message }));
    return () => {
      alive = false;
    };
  }, [api, selectedRepo, branch, path, tab, reloadAt]);

  const persist = useCallback((next: SavedRepo[]) => {
    setRepos(next);
    saveSavedRepos(next);
  }, []);

  const add = useCallback(() => {
    const { refs, invalid } = parseRepoRefs(draft);
    if (refs.length === 0) {
      setAddError(invalid.length > 0 ? `识别不出仓库：${invalid.slice(0, 3).join("、")}` : "先粘贴一个仓库链接");
      return;
    }
    let next = repos;
    let added = 0;
    for (const ref of refs) {
      const before = next.length;
      next = addSavedRepo(next, ref, "public");
      if (next.length > before) added += 1;
    }
    persist(next);
    setDraft("");
    setAddError(invalid.length > 0 ? `已添加 ${added} 个，忽略了 ${invalid.length} 条认不出的内容` : null);
    showToast(added > 0 ? `已添加 ${added} 个仓库` : "这些仓库已经在列表里了");
  }, [draft, persist, repos]);

  const remove = useCallback(
    (key: string) => {
      persist(removeSavedRepo(repos, key));
      if (selected === key) setSelected(null);
      showToast("已从列表移除");
    },
    [persist, repos, selected],
  );

  const refresh = useCallback(() => {
    requested.current.clear();
    setReloadAt((value) => value + 1);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSeconds, refresh]);

  /* ---------------- 详情视图 ---------------- */
  if (selectedRepo) {
    const repo = detail?.status === "ready" ? detail.value : null;
    const errorBanner =
      detail?.status === "error" ? (
        <Banner tone="error" icon="alert">
          {detail.message}
        </Banner>
      ) : null;

    return (
      <div className="page">
        <div className="gh-detail-head">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>
            <Icon name="chevronRight" size={14} className="flip" />
            全部仓库
          </button>
          <div className="gh-detail-title">
            <span className="gh-owner">{selectedRepo.owner}/</span>
            <strong>{selectedRepo.name}</strong>
          </div>
          <div className="spacer" />
          <a
            className="btn btn-ghost btn-sm"
            href={`https://github.com/${fullName(selectedRepo)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="external" size={14} />
            打开 GitHub
          </a>
        </div>

        {errorBanner}
        {!repo && detail?.status !== "error" ? <Loading label="正在读取仓库信息…" /> : null}

        {repo ? (
          <>
            <Card>
              <div className="gh-repo-head">
                <div>
                  <h2 className="gh-repo-name">{repo.fullName}</h2>
                  <p className="gh-repo-desc">{repo.description ?? "这个仓库没有写简介。"}</p>
                </div>
                <div className="gh-repo-tags">
                  {repo.archived ? <Badge tone="warn">已归档</Badge> : null}
                  {repo.fork ? <Badge tone="plain">Fork</Badge> : null}
                </div>
              </div>
              <div className="gh-meta">
                <span>
                  <Icon name="star" size={13} /> {fmtCount(repo.stars)}
                </span>
                <span>
                  <Icon name="fork" size={13} /> {fmtCount(repo.forks)}
                </span>
                <span>
                  <Icon name="alert" size={13} /> {fmtCount(repo.openIssues)} issues
                </span>
                <span>
                  <Icon name="shield" size={13} /> {repo.language ?? "未标注语言"}
                </span>
                <span>
                  <Icon name="clock" size={13} /> {repo.pushedAt ? `推送于 ${relTime(repo.pushedAt)}` : "还没有推送"}
                </span>
              </div>
            </Card>

            <div className="gh-detail-card">
            <Card
              flush
              head={
                <div className="gh-tabs">
                  <Tabs
                    value={tab}
                    onChange={setTab}
                    items={[
                      { key: "commits", label: "提交", count: commits.status === "ready" ? commits.value.length : undefined },
                      { key: "branches", label: "分支", count: branches.status === "ready" ? branches.value.length : undefined },
                      { key: "files", label: "文件" },
                      { key: "releases", label: "发行版", count: releases.status === "ready" ? releases.value.length : undefined },
                      { key: "readme", label: "README" },
                    ]}
                  />
                </div>
              }
              actions={
                <div className="gh-actions">
                  <GithubRefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />
                  <div className="gh-branch">
                    <span className="small dim">分支</span>
                    {branches.status === "ready" && branches.value.length > 0 ? (
                      <select className="select tiny" value={branch} onChange={(event) => setBranch(event.target.value)}>
                        {branches.value.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                            {item.isDefault ? "（默认）" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="small dim">{branch || "—"}</span>
                    )}
                  </div>
                </div>
              }
            >
              {tab === "commits" ? (
                <CommitList state={commits} />
              ) : tab === "branches" ? (
                <BranchList state={branches} />
              ) : tab === "files" ? (
                <FileBrowser
                  state={tree}
                  path={path}
                  onPath={(next) => setPath(next)}
                  onFile={(next) => setTab("readme")}
                />
              ) : tab === "releases" ? (
                <ReleaseList state={releases} />
              ) : (
                <ReadmePanel state={readme} />
              )}
            </Card>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  /* ---------------- 列表视图 ---------------- */
  return (
    <div className="page">
      {settings.mode === "demo" ? (
        <Banner tone="info" icon="info">
          当前其它页面使用演示数据；GitHub 页面始终读取真实公开仓库，不需要切换模式。
        </Banner>
      ) : null}

      <Card
        title="添加仓库"
        sub="粘贴 GitHub 仓库链接，可一次贴多个；只读公开仓库，不需要登录"
        actions={
          <div className="gh-actions">
            <GithubRefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />
            <div className="gh-rate">
              {rate ? (
                <span className="small dim">
                  当前 IP 配额 {rate.remaining}/{rate.limit} ·{" "}
                  {new Date(rate.resetAt).toLocaleTimeString("zh-CN", { hour12: false })} 重置
                </span>
              ) : null}
              <button type="button" className="btn btn-ghost btn-icon" onClick={refresh} title="重新读取">
                <Icon name="refresh" size={15} />
              </button>
            </div>
          </div>
        }
      >
        <div className="gh-add">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setAddError(null);
            }}
            onPressEnter={add}
            placeholder="https://github.com/owner/repo 或 owner/repo，可一次贴多个"
            allowClear
          />
          <button type="button" className="btn btn-primary" onClick={add}>
            添加
          </button>
        </div>
        {addError ? <p className="gh-add-error">{addError}</p> : null}
        <p className="gh-add-hint">
          支持 <code>owner/repo</code>、仓库首页链接、<code>git@github.com:owner/repo.git</code>、带
          <code>/tree/main/...</code> 的深层链接；换行、空格或逗号分隔都能一次加进来。
        </p>
      </Card>

      {repos.length === 0 ? (
        <Card>
          <Empty
            icon="git"
            title="还没有添加仓库"
            hint="把随便一个 GitHub 公开仓库链接粘到上面，比如 https://github.com/vercel/next.js"
          />
        </Card>
      ) : (
        <div className="gh-grid">
          {repos.map((item) => {
            const key = refKey(item);
            const meta = metas[key];
            const repo = meta?.status === "ready" ? meta.value : repoFromSaved(item);
            return (
              <article key={key} className="gh-card">
                <button type="button" className="gh-card-main" onClick={() => setSelected(key)}>
                  <div className="gh-card-top">
                    <span className="gh-owner">{repo.owner}/</span>
                    <strong className="gh-card-name">{repo.name}</strong>
                    {repo.archived ? <Badge tone="warn">归档</Badge> : null}
                    {repo.fork ? <Badge tone="plain">Fork</Badge> : null}
                  </div>
                  <p className="gh-card-desc">
                    {meta?.status === "error"
                      ? meta.message
                      : repo.description ?? (meta?.status === "loading" ? "正在读取简介…" : "没有写简介")}
                  </p>
                  <div className="gh-card-foot">
                    <span>
                      <Icon name="star" size={13} /> {fmtCount(repo.stars)}
                    </span>
                    <span>
                      <Icon name="fork" size={13} /> {fmtCount(repo.forks)}
                    </span>
                    <span>
                      <Icon name="shield" size={13} /> {repo.language ?? "—"}
                    </span>
                    <span className="spacer" />
                    <span>{repo.pushedAt ? relTime(repo.pushedAt) : "刚刚添加"}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="gh-card-remove"
                  title="从列表移除"
                  onClick={() => remove(key)}
                >
                  <Icon name="x" size={13} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 子视图                                                              */
/* ------------------------------------------------------------------ */

function CommitList({ state }: { state: Loadable<GithubCommit[]> }) {
  if (state.status === "loading") return <Loading label="正在读取提交…" />;
  if (state.status === "error") return <Banner tone="error" icon="alert">{state.message}</Banner>;
  if (state.value.length === 0) return <Empty icon="git" title="这个分支没有提交" />;
  return (
    <DataTable
      rows={state.value}
      rowKey={(row) => row.sha}
      columns={[
        {
          key: "sha",
          header: "提交",
          width: 96,
          render: (row) => <span className="mono gh-sha">{row.short}</span>,
        },
        {
          key: "message",
          header: "说明",
          render: (row) => (
            <div className="gh-commit">
              <span className="truncate">{row.message.split("\n")[0]}</span>
              <span className="small dim">{row.author}</span>
            </div>
          ),
        },
        {
          key: "date",
          header: "时间",
          align: "right",
          width: 110,
          render: (row) => <span className="small dim">{relTime(row.date)}</span>,
        },
      ]}
    />
  );
}

function BranchList({ state }: { state: Loadable<GithubBranch[]> }) {
  if (state.status === "loading") return <Loading label="正在读取分支…" />;
  if (state.status === "error") return <Banner tone="error" icon="alert">{state.message}</Banner>;
  if (state.value.length === 0) return <Empty icon="git" title="没有分支" />;
  return (
    <DataTable
      rows={state.value}
      rowKey={(row) => row.name}
      columns={[
        {
          key: "name",
          header: "分支",
          render: (row) => (
            <span className="gh-branch">
              <span className="mono">{row.name}</span>
              {row.isDefault ? <Badge tone="info">默认</Badge> : null}
              {row.protected ? <Badge tone="plain">受保护</Badge> : null}
            </span>
          ),
        },
        {
          key: "sha",
          header: "最新提交",
          width: 110,
          render: (row) => <span className="mono gh-sha">{row.sha.slice(0, 7)}</span>,
        },
      ]}
    />
  );
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function ReleaseList({ state }: { state: Loadable<GithubRelease[]> }) {
  if (state.status === "loading") return <Loading label="正在读取发行版…" />;
  if (state.status === "error") return <Banner tone="error" icon="alert">{state.message}</Banner>;
  if (state.value.length === 0) {
    return <Empty icon="box" title="这个仓库还没有发行版" hint="推送 tag 并创建 GitHub Release 后，这里会显示安装包和校验文件。" />;
  }
  return (
    <div className="gh-releases">
      {state.value.map((release) => (
        <article className="gh-release" key={release.id || release.tagName}>
          <div className="gh-release-head">
            <span className="mono gh-release-tag">{release.tagName}</span>
            <strong>{release.name || release.tagName}</strong>
            {release.prerelease ? <Badge tone="warn">预发行</Badge> : null}
            {release.draft ? <Badge tone="plain">草稿</Badge> : null}
            <span className="small dim">{release.publishedAt ? relTime(release.publishedAt) : "未发布"}</span>
            <a className="gh-release-link small" href={release.htmlUrl} target="_blank" rel="noreferrer">
              打开 <Icon name="external" size={12} />
            </a>
          </div>
          {release.body ? <p className="gh-release-body">{release.body.slice(0, 320)}</p> : null}
          <div className="gh-release-assets">
            {release.assets.length > 0 ? (
              release.assets.map((asset) => (
                <a
                  className="gh-release-asset"
                  href={asset.browserDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={`${release.id}-${asset.name}`}
                  title={asset.contentType}
                >
                  <Icon name="box" size={14} />
                  <span className="truncate">{asset.name}</span>
                  <span className="small dim">
                    {fmtBytes(asset.size)} · {asset.downloadCount} 次下载
                  </span>
                </a>
              ))
            ) : (
              <span className="small dim">这个发行版没有附件。</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function FileBrowser({
  state,
  path,
  onPath,
}: {
  state: Loadable<GithubTree>;
  path: string;
  onPath: (next: string) => void;
  onFile: (next: string) => void;
}) {
  if (state.status === "loading") return <Loading label="正在读取目录…" />;
  if (state.status === "error") return <Banner tone="error" icon="alert">{state.message}</Banner>;

  const segments = path.split("/").filter(Boolean);
  const file = state.value.file;

  return (
    <div className="gh-browser">
      <p className="small dim gh-file-note">
        源码目录不包含 GitHub Releases 的安装包；发行文件请切换到「发行版」查看。
      </p>
      <div className="gh-crumbs">
        <button type="button" className="gh-crumb" onClick={() => onPath("")}>
          根目录
        </button>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} className="gh-crumb-wrap">
            <span className="gh-crumb-sep">/</span>
            <button
              type="button"
              className="gh-crumb"
              onClick={() => onPath(segments.slice(0, index + 1).join("/"))}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      {file ? (
        <>
          <div className="gh-file-head">
            <span className="mono">{file.path}</span>
            <span className="small dim">
              {file.size} B{file.binary ? " · 二进制文件" : ""}
              {file.truncated ? " · 文件过大，接口没有返回正文" : ""}
            </span>
          </div>
          {file.binary || file.truncated || !file.text ? (
            <p className="small dim">这个文件不在页面里展示，去 GitHub 看原文。</p>
          ) : (
            <pre className="code-block gh-file">{file.text}</pre>
          )}
        </>
      ) : state.value.entries.length === 0 ? (
        <Empty icon="folder" title="空目录" />
      ) : (
        <DataTable
          rows={state.value.entries}
          rowKey={(row) => row.path}
          onRowClick={(row) => onPath(row.path)}
          columns={[
            {
              key: "name",
              header: "名称",
              render: (row) => (
                <span className="gh-entry">
                  <Icon name={row.type === "dir" ? "folder" : "file"} size={14} />
                  <span className="mono">{row.name}</span>
                </span>
              ),
            },
            {
              key: "type",
              header: "类型",
              width: 90,
              render: (row) => <span className="small dim">{row.type === "dir" ? "目录" : row.type === "submodule" ? "子模块" : "文件"}</span>,
            },
            {
              key: "size",
              header: "大小",
              width: 96,
              align: "right",
              render: (row) => <span className="small dim">{row.type === "dir" ? "—" : `${fmtCount(row.size)} B`}</span>,
            },
          ]}
        />
      )}
    </div>
  );
}

function renderInline(nodes: Inline[], keyPrefix: string) {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.kind === "text") return <span key={key}>{node.text}</span>;
    if (node.kind === "code") return <code key={key}>{node.text}</code>;
    if (node.kind === "bold") return <strong key={key}>{node.text}</strong>;
    return (
      <a key={key} href={node.href} target="_blank" rel="noreferrer">
        {node.text}
      </a>
    );
  });
}

function renderBlock(block: Block, index: number) {
  const key = `block-${index}`;

  if (block.kind === "heading") {
    const inline = renderInline(parseInline(block.text), key);
    if (block.level <= 1) return <h2 key={key} className="readme-h1">{inline}</h2>;
    if (block.level === 2) return <h3 key={key} className="readme-h2">{inline}</h3>;
    return <h4 key={key} className={`readme-h${block.level}`}>{inline}</h4>;
  }
  if (block.kind === "code") {
    return (
      <pre key={key} className="readme-pre">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "list") {
    const items = block.items.map((item, itemIndex) => (
      <li key={`${key}-${itemIndex}`}>{renderInline(parseInline(item), `${key}-${itemIndex}`)}</li>
    ));
    return block.ordered ? (
      <ol key={key} className="readme-list">{items}</ol>
    ) : (
      <ul key={key} className="readme-list">{items}</ul>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote key={key} className="readme-quote">
        {renderInline(parseInline(block.text), key)}
      </blockquote>
    );
  }
  if (block.kind === "rule") return <hr key={key} className="readme-rule" />;
  return (
    <p key={key} className="readme-p">
      {renderInline(parseInline(block.text), key)}
    </p>
  );
}

function ReadmePanel({ state }: { state: Loadable<GithubFile | null> }) {
  const blocks = useMemo(
    () => (state.status === "ready" && state.value?.text ? parseMarkdown(state.value.text) : null),
    [state],
  );

  if (state.status === "loading") return <Loading label="正在读取 README…" />;
  if (state.status === "error") return <Banner tone="error" icon="alert">{state.message}</Banner>;
  if (!blocks || blocks.length === 0) return <Empty icon="file" title="这个仓库没有 README" />;

  return <article className="readme">{blocks.map(renderBlock)}</article>;
}
