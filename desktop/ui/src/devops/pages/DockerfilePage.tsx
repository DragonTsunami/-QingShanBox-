import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icons";
import { Badge, Banner, Card, Loading, Tabs } from "../components/ui";
import { showToast } from "../components/toast";
import { clientSignature } from "../lib/actions";
import {
  TARGET_LABEL,
  draftWarnings,
  importFromContainer,
  loadDrafts,
  newDraft,
  renderTarget,
  saveDrafts,
  slug,
  tagFor,
  type CopyRule,
  type DockerfileDraft,
  type DockerfileTarget,
  type EnvPair,
} from "../lib/dockerfile";
import { useResource } from "../lib/useResource";
import type { PageProps } from "../lib/page";

const TARGETS: DockerfileTarget[] = ["dockerfile", "build", "run", "compose"];

function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(items: string[]): string {
  return items.join(", ");
}

export function DockerfilePage({ client, settings }: PageProps) {
  const resource = useResource(() => client.docker(), clientSignature(settings.mode, settings.agentUrl, "dockerfile"));
  const containers = resource.data?.containers ?? [];

  const [initial] = useState<DockerfileDraft[]>(() => {
    const stored = loadDrafts();
    return stored.length > 0 ? stored : [newDraft()];
  });
  const [drafts, setDrafts] = useState<DockerfileDraft[]>(initial);
  const [activeId, setActiveId] = useState<string>(initial[0].id);
  const [draft, setDraft] = useState<DockerfileDraft>(initial[0]);
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<DockerfileTarget>("dockerfile");

  const patch = useCallback((partial: Partial<DockerfileDraft>) => {
    setDraft((current) => ({ ...current, ...partial, updatedAt: Date.now() }));
    setDirty(true);
  }, []);

  useEffect(() => {
    saveDrafts(initial);
  }, [initial]);

  const persist = useCallback(
    (next: DockerfileDraft) => {
      const merged = drafts.some((item) => item.id === next.id)
        ? drafts.map((item) => (item.id === next.id ? next : item))
        : [...drafts, next];
      setDrafts(merged);
      saveDrafts(merged);
      setDirty(false);
    },
    [drafts],
  );

  const save = useCallback(() => {
    persist(draft);
    showToast(`草稿「${draft.name || "未命名"}」已保存到本机`);
  }, [draft, persist]);

  const createDraft = useCallback(() => {
    const fresh = newDraft(`service-${drafts.length + 1}`);
    const merged = [...drafts, fresh];
    setDrafts(merged);
    setDraft(fresh);
    setActiveId(fresh.id);
    setDirty(true);
    saveDrafts(merged);
  }, [drafts]);

  const removeDraft = useCallback(() => {
    const rest = drafts.filter((item) => item.id !== draft.id);
    const next = rest[0] ?? newDraft();
    const merged = rest.length > 0 ? rest : [next];
    setDrafts(merged);
    setDraft(next);
    setActiveId(next.id);
    setDirty(rest.length === 0);
    saveDrafts(merged);
    showToast("草稿已删除");
  }, [draft.id, drafts]);

  const selectDraft = useCallback(
    (id: string) => {
      const found = drafts.find((item) => item.id === id);
      if (!found) return;
      setDraft(found);
      setActiveId(id);
      setDirty(false);
    },
    [drafts],
  );

  const importContainer = useCallback(
    (id: string) => {
      const container = containers.find((item) => item.id === id);
      if (!container) return;
      const imported = importFromContainer(container);
      setDraft(imported);
      setActiveId(imported.id);
      setDirty(true);
      showToast(`已从容器 ${container.name} 反推草稿，环境变量与卷待补`);
    },
    [containers],
  );

  const output = useMemo(() => renderTarget(draft, target), [draft, target]);
  const warnings = useMemo(() => draftWarnings(draft), [draft]);
  const stored = drafts.some((item) => item.id === draft.id);
  const savedLabel = !dirty && stored;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      showToast(`已复制${TARGET_LABEL[target]}`);
    } catch {
      showToast("浏览器拒绝了剪贴板访问，请手动选中复制", "warn");
    }
  }, [output, target]);

  const download = useCallback(() => {
    const name = target === "compose" ? "docker-compose.yml" : target === "dockerfile" ? "Dockerfile" : `${slug(draft.name)}-${target}.txt`;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${name}`);
  }, [draft.name, output, target]);

  const setEnv = (index: number, partial: Partial<EnvPair>) =>
    patch({ env: draft.env.map((item, cursor) => (cursor === index ? { ...item, ...partial } : item)) });
  const setCopy = (index: number, partial: Partial<CopyRule>) =>
    patch({ copy: draft.copy.map((item, cursor) => (cursor === index ? { ...item, ...partial } : item)) });
  const setRun = (index: number, value: string) =>
    patch({ run: draft.run.map((item, cursor) => (cursor === index ? value : item)) });

  return (
    <div className="page">
      <Banner tone="info">
        编辑器只生成文件与命令，不会在你的机器上执行 <span className="mono">docker build</span> / <span className="mono">docker run</span>。
        导出 Dockerfile 后自行构建；草稿保存在本机浏览器里，换机器需要重新导出。
      </Banner>

      {warnings.length > 0 && (
        <Banner tone="warn">
          {warnings.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </Banner>
      )}

      <div className="editor-split">
        <div className="stack">
          <Card
            title="草稿"
            sub={<span className="mono">{tagFor(draft)}</span>}
            actions={
              <span className="row" style={{ gap: 8 }}>
                <Badge tone={savedLabel ? "ok" : "warn"}>{savedLabel ? "已保存" : "未保存"}</Badge>
                <button type="button" className="btn btn-ghost btn-sm" onClick={createDraft}>
                  <Icon name="plus" size={12} /> 新建
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={removeDraft}>
                  <Icon name="x" size={12} /> 删除
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save}>
                  <Icon name="check" size={12} /> 保存草稿
                </button>
              </span>
            }
          >
            <div className="grid cols-2">
              <label className="field">
                <span className="field-label">切换草稿</span>
                <select className="select wide" value={activeId} onChange={(event) => selectDraft(event.target.value)}>
                  {drafts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || "未命名"} · {item.baseImage || "无基础镜像"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">从运行中的容器导入</span>
                <select
                  className="select wide"
                  value=""
                  disabled={containers.length === 0}
                  onChange={(event) => {
                    importContainer(event.target.value);
                    event.target.value = "";
                  }}
                >
                  <option value="">{containers.length === 0 ? "没有可导入的容器" : "选择容器…"}</option>
                  {containers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.image}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card title="基础" sub="FROM / WORKDIR / USER">
            <div className="grid cols-2">
              <label className="field">
                <span className="field-label">镜像名</span>
                <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                <span className="field-hint">决定导出文件名与镜像标签</span>
              </label>
              <label className="field">
                <span className="field-label">基础镜像</span>
                <input className="input mono" value={draft.baseImage} onChange={(event) => patch({ baseImage: event.target.value })} />
                <span className="field-hint">例如 node:22-alpine / nginx:1.27-alpine</span>
              </label>
              <label className="field">
                <span className="field-label">工作目录</span>
                <input className="input mono" value={draft.workdir} onChange={(event) => patch({ workdir: event.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">运行用户</span>
                <input className="input mono" value={draft.user} onChange={(event) => patch({ user: event.target.value })} />
                <span className="field-hint">留空表示用基础镜像默认用户</span>
              </label>
            </div>
          </Card>

          <Card title="构建步骤" sub="COPY / RUN，按顺序写进镜像">
            <div className="stack" style={{ gap: 10 }}>
              {draft.copy.map((rule, index) => (
                <div className="edit-row" key={`copy-${index}`}>
                  <input
                    className="input mono"
                    value={rule.from}
                    placeholder="源路径，例如 package*.json"
                    onChange={(event) => setCopy(index, { from: event.target.value })}
                  />
                  <input
                    className="input mono"
                    value={rule.to}
                    placeholder="目标路径，例如 ./"
                    onChange={(event) => setCopy(index, { to: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="删除这一行"
                    onClick={() => patch({ copy: draft.copy.filter((_, cursor) => cursor !== index) })}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ copy: [...draft.copy, { from: "", to: "./" }] })}>
                <Icon name="plus" size={12} /> 添加 COPY
              </button>

              {draft.run.map((line, index) => (
                <div className="edit-row run-row" key={`run-${index}`}>
                  <input className="input mono" value={line} placeholder="npm ci" onChange={(event) => setRun(index, event.target.value)} />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="删除这一行"
                    onClick={() => patch({ run: draft.run.filter((_, cursor) => cursor !== index) })}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ run: [...draft.run, ""] })}>
                <Icon name="plus" size={12} /> 添加 RUN
              </button>
            </div>
          </Card>

          <Card title="运行配置" sub="ENV / EXPOSE / VOLUME / HEALTHCHECK / CMD">
            <div className="stack" style={{ gap: 12 }}>
              {draft.env.map((item, index) => (
                <div className="edit-row" key={`env-${index}`}>
                  <input className="input mono" value={item.key} placeholder="KEY" onChange={(event) => setEnv(index, { key: event.target.value })} />
                  <input className="input mono" value={item.value} placeholder="value" onChange={(event) => setEnv(index, { value: event.target.value })} />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="删除这一行"
                    onClick={() => patch({ env: draft.env.filter((_, cursor) => cursor !== index) })}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ env: [...draft.env, { key: "", value: "" }] })}>
                <Icon name="plus" size={12} /> 添加环境变量
              </button>

              <div className="grid cols-2">
                <label className="field">
                  <span className="field-label">暴露端口</span>
                  <input
                    className="input mono"
                    value={joinList(draft.ports)}
                    placeholder="8080, 9090"
                    onChange={(event) => patch({ ports: splitList(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">数据卷</span>
                  <input
                    className="input mono"
                    value={joinList(draft.volumes)}
                    placeholder="/data, /var/log/app"
                    onChange={(event) => patch({ volumes: splitList(event.target.value) })}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">健康检查</span>
                <input
                  className="input mono"
                  value={draft.healthcheck}
                  placeholder="curl -fsS http://127.0.0.1:8080/healthz"
                  onChange={(event) => patch({ healthcheck: event.target.value })}
                />
                <span className="field-hint">写命令即可，会自动补 HEALTHCHECK 参数；以 HEALTHCHECK 开头则原样写入</span>
              </label>

              <div className="grid cols-2">
                <label className="field">
                  <span className="field-label">ENTRYPOINT</span>
                  <input className="input mono" value={draft.entrypoint} placeholder="留空表示不覆盖" onChange={(event) => patch({ entrypoint: event.target.value })} />
                </label>
                <label className="field">
                  <span className="field-label">CMD</span>
                  <input className="input mono" value={draft.cmd} onChange={(event) => patch({ cmd: event.target.value })} />
                </label>
              </div>

              <label className="field">
                <span className="field-label">附加指令</span>
                <textarea
                  className="input mono"
                  rows={3}
                  value={draft.extra}
                  placeholder={"LABEL org.opencontainers.image.title=\"qingshan-api\"\nSTOPSIGNAL SIGTERM"}
                  onChange={(event) => patch({ extra: event.target.value })}
                />
                <span className="field-hint">原样追加到文件末尾，一行一条指令</span>
              </label>
            </div>
          </Card>
        </div>

        <div className="editor-preview">
          <Card
            flush
            title={TARGET_LABEL[target]}
            sub={target === "dockerfile" ? "可直接保存为 Dockerfile" : "复制到终端执行，或导出为文件"}
            actions={
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                  <Icon name="terminal" size={12} /> 复制
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
                  <Icon name="external" size={12} /> 导出
                </button>
              </>
            }
          >
            <div style={{ padding: "0 18px 2px" }}>
              <Tabs items={TARGETS.map((key) => ({ key, label: TARGET_LABEL[key] }))} value={target} onChange={(key) => setTarget(key as DockerfileTarget)} />
            </div>
            {resource.loading ? (
              <Loading label="正在读取容器列表" />
            ) : (
              <pre className="code-block">{output}</pre>
            )}
            <div className="preview-foot">
              <span className="small dim">
                {draft.copy.length} COPY · {draft.run.length} RUN · {draft.env.length} ENV · {draft.ports.length} 端口
              </span>
              <span className="small dim">标签 {tagFor(draft)}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
