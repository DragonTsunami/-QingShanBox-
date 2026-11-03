import { showToast } from "../components/toast";
import type { ActionId, ClientMode } from "./types";

/**
 * 可执行动作的白名单说明。前端用它渲染确认弹窗，agent 端按同一批 id 执行，
 * 参数只接受容器名 / 仓库路径 / 流水线名，永远不拼自由命令行。
 */
export interface ActionMeta {
  id: ActionId;
  label: string;
  /** 会影响到什么，确认弹窗里要写清楚 */
  impact: string;
  /** 危险动作按钮用红色描边 */
  danger: boolean;
  validate: (target: string) => boolean;
}

const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PATH_LIKE = /^[^\r\n"]{1,260}$/;
const JOB = /^[A-Za-z0-9_.-]{1,120}$/;

export const ACTION_REGISTRY: Record<ActionId, ActionMeta> = {
  "docker.restart": {
    id: "docker.restart",
    label: "重启容器",
    impact: "容器会被停掉再启动，服务中断约 1-3 秒；有健康检查的容器会重新进入 starting。",
    danger: true,
    validate: (target) => CONTAINER.test(target),
  },
  "docker.start": {
    id: "docker.start",
    label: "启动容器",
    impact: "把已停止的容器拉起来，会占用它声明的端口和数据卷。",
    danger: false,
    validate: (target) => CONTAINER.test(target),
  },
  "docker.stop": {
    id: "docker.stop",
    label: "停止容器",
    impact: "容器停止后服务即刻不可用，直到你重新启动它。",
    danger: true,
    validate: (target) => CONTAINER.test(target),
  },
  "git.fetch": {
    id: "git.fetch",
    label: "拉取远端引用",
    impact: "只更新 origin/* 引用，不改工作区、不合并分支。",
    danger: false,
    validate: (target) => PATH_LIKE.test(target),
  },
  "git.pull": {
    id: "git.pull",
    label: "快进拉取",
    impact: "执行 pull --ff-only：只允许快进。本地有未提交改动或分叉时会失败，不会覆盖你的改动。",
    danger: false,
    validate: (target) => PATH_LIKE.test(target),
  },
  "jenkins.build": {
    id: "jenkins.build",
    label: "触发构建",
    impact: "在 Jenkins 上排队一次新构建，会用该流水线配置的分支；构建产物与部署由流水线自己决定。",
    danger: false,
    validate: (target) => JOB.test(target),
  },
};

export const ACTION_IDS = Object.keys(ACTION_REGISTRY) as ActionId[];

/** 确认弹窗里展示的命令文本：必须和 agent 实际执行的一致。 */
export function commandPreview(action: ActionId, target: string, jenkinsUrl = ""): string {
  switch (action) {
    case "docker.restart":
      return `docker restart ${target}`;
    case "docker.start":
      return `docker start ${target}`;
    case "docker.stop":
      return `docker stop ${target}`;
    case "git.fetch":
      return `git -C "${target}" fetch --prune`;
    case "git.pull":
      return `git -C "${target}" pull --ff-only`;
    case "jenkins.build": {
      const base = (jenkinsUrl || "https://<jenkins>").replace(/\/+$/, "");
      return `POST ${base}/job/${target}/build`;
    }
  }
}

/**
 * 不在白名单里的命令（logs / inspect / 日志查询等）仍然只做提示：
 * 复制到剪贴板，由你自己在终端里执行。
 */
export function announceCommand(command: string, mode: ClientMode): void {
  const prefix = mode === "demo" ? "演示模式" : "只读命令";
  void copyText(command)
    .then((copied) => {
      showToast(copied ? `${prefix}：已复制 ${command}` : `${prefix}：${command} 未执行`, copied ? "default" : "warn");
    })
    .catch(() => showToast(`${prefix}：${command} 未执行`, "warn"));
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 页面共用的数据源签名，切换模式/地址时触发重新拉取。 */
export function clientSignature(mode: ClientMode, agentUrl: string, key: string): string {
  return `${key}:${mode}:${mode === "agent" ? agentUrl : "demo"}`;
}
