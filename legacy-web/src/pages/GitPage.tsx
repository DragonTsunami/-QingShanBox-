import { useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, DataTable, Empty, Loading, Stat, Tabs } from "../components/ui";
import { announceCommand, clientSignature } from "../lib/actions";
import { num, relTime, size } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { DevopsClient, Settings } from "../lib/types";

export function GitPage({ client, settings }: { client: DevopsClient; settings: Settings }) {
  const resource = useResource(() => client.git(), clientSignature(settings.mode, settings.agentUrl, "git"));
  const [tab, setTab] = useState("commits");
  const [picked, setPicked] = useState<string | null>(null);

  const repos = resource.data?.repos ?? [];
  const repo = repos.find((item) => item.id === (picked ?? repos[0]?.id)) ?? null;
  const commits = repo ? (resource.data?.commits[repo.id] ?? []) : [];
  const branches = repo ? (resource.data?.branches[repo.id] ?? []) : [];

  const ahead = repos.reduce((sum, item) => sum + item.ahead, 0);
  const behind = repos.reduce((sum, item) => sum + item.behind, 0);
  const dirty = repos.reduce((sum, item) => sum + item.dirty, 0);
  const sizeTotal = repos.reduce((sum, item) => sum + item.sizeMb, 0);

  const dirtyRepos = repos.filter((item) => item.dirty > 0).length;

  if (resource.loading && !resource.data) return <Loading label="正在读取本地 Git 仓库…" />;
  if (resource.error && !resource.data) {
    return (
      <div className="page">
        <Empty
          icon="alert"
          title="读不到 Git 数据"
          hint={resource.error}
          action={<button type="button" className="btn" onClick={resource.reload}>重试</button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      {resource.data?.note && <Banner tone="warn">{resource.data.note}</Banner>}
      <div className="grid cols-4">
        <Stat icon="git" label="仓库" value={String(repos.length)} foot={<span>共 {size(sizeTotal)}</span>} />
        <Stat icon="chevronRight" label="未推送提交" value={String(ahead)} foot={<span>ahead of upstream</span>} />
        <Stat icon="chevronDown" label="未拉取提交" value={String(behind)} foot={<span>behind of upstream</span>} />
        <Stat icon="drive" label="未提交变更" value={String(dirty)} foot={<span>{dirtyRepos} 个仓库有未提交改动</span>} />
      </div>

      <div className="split">
        <Card title="仓库" sub="本地工作副本">
          <div className="list">
            {repos.map((item) => (
              <button
                key={item.id}
                type="button"
                className={repo?.id === item.id ? "list-item active" : "list-item"}
                onClick={() => setPicked(item.id)}
              >
                <span className="list-title">
                  <span className={`dot ${item.dirty > 0 ? "dot-warn" : item.ahead > 0 ? "dot-up" : "dot-idle"}`} />
                  {item.name}
                </span>
                <span className="list-sub">
                  <Icon name="git" size={10} /> {item.branch}
                  {item.ahead > 0 ? ` · ↑${item.ahead}` : ""}
                  {item.behind > 0 ? ` · ↓${item.behind}` : ""}
                  {item.dirty > 0 ? ` · ${item.dirty} 个改动` : ""}
                </span>
                <span className="list-sub">{item.lastCommitSubject}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card
          flush
          title={repo ? `${repo.name} · ${repo.branch}` : "提交"}
          sub={repo ? `${repo.path} · 最近提交 ${relTime(repo.lastCommitAt)}` : undefined}
          actions={
            repo && (
              <>
                <button
                  type="button"
                  className="btn btn-icon btn-sm"
                  title="git fetch --all --prune"
                  onClick={() => announceCommand(`git -C "${repo.path}" fetch --all --prune`, settings.mode)}
                >
                  <Icon name="refresh" size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => announceCommand(`git -C "${repo.path}" pull --ff-only`, settings.mode)}
                >
                  <Icon name="chevronDown" size={12} /> 拉取
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => announceCommand(`git -C "${repo.path}" log --oneline -20`, settings.mode)}
                >
                  <Icon name="terminal" size={12} /> 日志
                </button>
              </>
            )
          }
        >
          <div style={{ padding: "0 18px 14px" }}>
            <Tabs
              items={[
                { key: "commits", label: "提交", count: commits.length },
                { key: "branches", label: "分支", count: branches.length },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
          {tab === "commits" ? (
            <DataTable
              rows={commits}
              rowKey={(row) => row.hash}
              columns={[
                { key: "hash", header: "提交", width: 90, render: (row) => <span className="mono">{row.short}</span> },
                {
                  key: "subject",
                  header: "说明",
                  render: (row) => {
                    const label = row.subject.length > 52 ? `${row.subject.slice(0, 52)}…` : row.subject;
                    return (
                      <span className="strong nowrap" title={row.subject}>
                        {label}
                      </span>
                    );
                  },
                },
                { key: "author", header: "作者", render: (row) => <span className="small">{row.author}</span> },
                { key: "when", header: "时间", render: (row) => <span className="small dim">{relTime(row.when)}</span> },
                {
                  key: "diff",
                  header: "变更",
                  align: "right",
                  render: (row) => (
                    <span className="mono small">
                      <span className="up">+{row.insertions}</span> <span className="down">-{row.deletions}</span>
                    </span>
                  ),
                },
                { key: "files", header: "文件", align: "right", render: (row) => <span className="small dim">{row.files}</span> },
              ]}
              empty={<Empty icon="git" title="这个仓库还没有提交记录" />}
            />
          ) : (
            <DataTable
              rows={branches}
              rowKey={(row) => row.name}
              columns={[
                {
                  key: "name",
                  header: "分支",
                  render: (row) => (
                    <span className="row" style={{ gap: 6 }}>
                      <span className="strong mono">{row.name}</span>
                      {row.isDefault && <Badge>默认</Badge>}
                    </span>
                  ),
                },
                {
                  key: "track",
                  header: "跟踪",
                  render: (row) => (
                    <span className="small">
                      {row.ahead > 0 ? <span className="up">↑{row.ahead} </span> : null}
                      {row.behind > 0 ? <span className="down">↓{row.behind}</span> : null}
                      {row.ahead === 0 && row.behind === 0 ? <span className="dim">已同步</span> : null}
                    </span>
                  ),
                },
                { key: "author", header: "最后作者", render: (row) => <span className="small">{row.author}</span> },
                { key: "when", header: "时间", render: (row) => <span className="small dim">{relTime(row.lastCommitAt)}</span> },
                {
                  key: "action",
                  header: "",
                  align: "right",
                  render: (row) => (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => repo && announceCommand(`git -C "${repo.path}" switch ${row.name}`, settings.mode)}
                    >
                      切换
                    </button>
                  ),
                },
              ]}
              empty={<Empty icon="git" title="没有分支信息" />}
            />
          )}
        </Card>
      </div>

      {repo && (
        <Card title="工作区状态" sub={`${repo.remote}`}>
          <div className="grid cols-4">
            <Stat label="当前分支" value={<span className="mono" style={{ fontSize: 18 }}>{repo.branch}</span>} foot={<span>{repo.dirty > 0 ? `${repo.dirty} 个未提交改动` : "工作区干净"}</span>} />
            <Stat label="领先 / 落后" value={`${num(repo.ahead)} / ${num(repo.behind)}`} foot={<span>相对 origin/{repo.branch}</span>} />
            <Stat label="最近提交" value={<span style={{ fontSize: 15 }}>{repo.lastCommitSubject}</span>} foot={<span>{relTime(repo.lastCommitAt)}</span>} />
            <Stat label="仓库大小" value={size(repo.sizeMb)} foot={<span>.git 与工作区合计</span>} />
          </div>
        </Card>
      )}
    </div>
  );
}
