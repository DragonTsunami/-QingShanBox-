import { useState } from "react";
import { Icon } from "../components/Icons";
import { Banner, Card, Field, Segmented, Status, type StatusTone } from "../components/ui";
import { showToast } from "../components/toast";
import { probeAgent } from "../lib/client";
import { DEFAULT_SETTINGS, ENV_LABEL } from "../lib/store";
import type { EnvName, Settings } from "../lib/types";

const ENDPOINTS: { key: keyof Settings["endpoints"]; label: string; hint: string; placeholder: string }[] = [
  { key: "docker", label: "Docker", hint: "Docker 上下文或 socket", placeholder: "npipe://./pipe/docker_engine" },
  { key: "mysql", label: "MySQL", hint: "主机:端口，用于只读指标与慢查询", placeholder: "10.20.8.11:3306" },
  { key: "terraform", label: "Terraform", hint: "状态后端地址（本地路径 / s3 / azurerm）", placeholder: "s3://qingshan-tfstate" },
  { key: "ansible", label: "Ansible", hint: "inventory 文件路径", placeholder: "ansible/inventory/prod.ini" },
  { key: "git", label: "Git", hint: "仓库根目录，可包含多个子仓库", placeholder: "D:\\work" },
  { key: "jenkins", label: "Jenkins", hint: "控制台地址，本轮只读取状态", placeholder: "https://ci.qingshan.dev" },
  { key: "prometheus", label: "Prometheus", hint: "HTTP API 地址", placeholder: "http://prom.qingshan.dev:9090" },
  { key: "grafana", label: "Grafana", hint: "控制台地址，用于跳转仪表盘", placeholder: "https://grafana.qingshan.dev" },
];

const ENVS: EnvName[] = ["dev", "staging", "prod"];

const MODULES: { key: keyof Settings["modules"]; label: string; hint: string }[] = [
  { key: "terraform", label: "Terraform", hint: "工作区状态、漂移与变更预览；不写基础设施即代码时可以关掉" },
  { key: "ansible", label: "Ansible", hint: "主机清单、剧本与最近运行；没有批量运维需求时可以关掉" },
];

interface ProbeState {
  tone: StatusTone;
  text: string;
}

export function SettingsPage({ settings, onSave }: { settings: Settings; onSave: (next: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [probing, setProbing] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  function patch(next: Partial<Settings>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function patchEndpoint(key: keyof Settings["endpoints"], value: string) {
    setDraft((prev) => ({ ...prev, endpoints: { ...prev.endpoints, [key]: value } }));
  }

  async function testConnection() {
    setProbing(true);
    setProbe(null);
    const result = await probeAgent(draft.agentUrl.trim() || DEFAULT_SETTINGS.agentUrl);
    setProbing(false);
    setProbe(
      result.ok
        ? { tone: "ok", text: `已连接 · ${result.version ?? "版本未知"} · ${result.platform ?? "平台未知"}` }
        : { tone: "err", text: result.detail },
    );
  }

  function save() {
    onSave(draft);
    showToast("设置已保存到本机");
  }

  function reset() {
    setDraft(DEFAULT_SETTINGS);
    setProbe(null);
    showToast("已恢复默认值，记得保存");
  }

  return (
    <div className="page">
      <Banner tone="info" icon="info">
        工作台里的快捷动作会真正下发命令，但每次都要在确认弹窗里点一次执行。命令只能从固定白名单里选，
        <strong>不能自由执行命令行</strong>；白名单之外的操作仍然只复制命令给你，由你在终端里跑。
      </Banner>

      <div className="grid cols-2">
        <Card title="数据来源" sub="决定页面从哪里取数">
          <div className="stack" style={{ gap: 18 }}>
            <Field label="模式" hint="演示模式使用内置样例数据；本地 agent 模式通过 HTTP 读取本机真实状态。">
              <Segmented
                items={[
                  { key: "demo", label: "演示数据" },
                  { key: "agent", label: "本地 agent" },
                ]}
                value={draft.mode}
                onChange={(key) => patch({ mode: key as Settings["mode"] })}
              />
            </Field>

            <Field label="Agent 地址" hint="本地采集服务默认监听 127.0.0.1:7331，只绑定回环地址，不对外暴露。">
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input mono wide"
                  value={draft.agentUrl}
                  spellCheck={false}
                  placeholder={DEFAULT_SETTINGS.agentUrl}
                  onChange={(event) => patch({ agentUrl: event.target.value })}
                />
                <button type="button" className="btn" onClick={() => void testConnection()} disabled={probing}>
                  <Icon name="activity" size={13} />
                  {probing ? "测试中…" : "测试连接"}
                </button>
              </div>
              {probe && (
                <div style={{ marginTop: 8 }}>
                  <Status tone={probe.tone}>{probe.text}</Status>
                </div>
              )}
            </Field>

            <Field
              label="执行令牌"
              hint="agent 启动时打印的一串令牌，只存在这台机器的浏览器里；留空表示不允许下发命令。"
            >
              <input
                className="input mono wide"
                value={draft.agentToken}
                spellCheck={false}
                autoComplete="off"
                placeholder="粘贴 agent 启动日志里的「执行令牌」"
                onChange={(event) => patch({ agentToken: event.target.value.trim() })}
              />
            </Field>

            <Field label="当前环境" hint="仅作为界面标签与命令提示中的变量，不会改变 agent 的实际行为。">
              <div className="segmented" role="group">
                {ENVS.map((env) => (
                  <button
                    key={env}
                    type="button"
                    className={draft.env === env ? "active" : undefined}
                    onClick={() => patch({ env })}
                  >
                    {ENV_LABEL[env]}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card title="接入说明" sub="这一版怎么用、下一版接到哪里">
          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-key">交付形态</span>
              <span className="kv-value">独立 web 应用，可单独部署</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">与工具箱的关系</span>
              <span className="kv-value">同源设计 token，后续作为内置插件页嵌入</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">数据边界</span>
              <span className="kv-value">全部在本机；agent 只监听 127.0.0.1</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">凭据</span>
              <span className="kv-value">采集凭据由 agent 侧环境变量提供；执行令牌只存本机浏览器</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">设置存放</span>
              <span className="kv-value mono">localStorage · qingshan.devops.settings</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="模块" sub="用不到的模块先隐藏，侧栏只保留日常会看的">
        {MODULES.map((item) => (
          <div className="module-row" key={item.key}>
            <span className="module-meta">
              <span className="module-name">{item.label}</span>
              <span className="module-hint">{item.hint}</span>
            </span>
            <button
              type="button"
              className={draft.modules[item.key] ? "btn btn-ghost btn-sm" : "btn btn-sm"}
              onClick={() => setDraft((prev) => ({ ...prev, modules: { ...prev.modules, [item.key]: !prev.modules[item.key] } }))}
            >
              {draft.modules[item.key] ? "隐藏" : "显示"}
            </button>
          </div>
        ))}
        <p className="small dim" style={{ margin: "12px 0 0" }}>
          Docker / Dockerfile / MySQL / Git / Jenkins / 可观测性是核心模块，始终显示；改动后点下面的「保存设置」生效。
        </p>
      </Card>

      <Card
        title="数据端点"
        sub="agent 模式下读取这些地址；演示模式下仅作展示"
        actions={
          <span className="small dim">{dirty ? "有未保存的修改" : "已保存"}</span>
        }
      >
        <div className="grid cols-2">
          {ENDPOINTS.map((item) => (
            <Field key={item.key} label={item.label} hint={item.hint}>
              <input
                className="input mono"
                value={draft.endpoints[item.key]}
                spellCheck={false}
                placeholder={item.placeholder}
                onChange={(event) => patchEndpoint(item.key, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={reset}>
            恢复默认
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty}>
            <Icon name="check" size={13} /> 保存设置
          </button>
        </div>
      </Card>
    </div>
  );
}
