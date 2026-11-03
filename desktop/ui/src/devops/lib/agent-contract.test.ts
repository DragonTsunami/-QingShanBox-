import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const agentPath = fileURLToPath(new URL("../../../server/agent.mjs", import.meta.url));
const source = readFileSync(agentPath, "utf8");

const ENDPOINTS = [
  "health",
  "sources",
  "docker",
  "mysql",
  "terraform",
  "ansible",
  "git",
  "jenkins",
  "observability",
];

describe("agent 与前端契约", () => {
  it("暴露前端用到的全部接口", () => {
    for (const endpoint of ENDPOINTS) {
      expect(source).toContain(`"/api/${endpoint}"`);
    }
  });

  it("只绑定回环地址", () => {
    expect(source).toContain('const HOST = "127.0.0.1"');
    expect(source).not.toMatch(/0\.0\.0\.0/);
  });

  it("执行通道要令牌，且只认白名单动作", () => {
    expect(source).toContain('url.pathname !== "/api/actions"');
    expect(source).toContain("x-qingshan-token");
    expect(source).toContain("crypto.timingSafeEqual");
    expect(source).toContain('case "docker.restart"');
    expect(source).toContain('case "git.pull"');
    expect(source).toContain('"git", "-C", root, "pull", "--ff-only"');
    expect(source).toContain("qingshan-devops-actions.jsonl");
    // 只允许 execFile（不经 shell），不能出现 exec(
    expect(source).not.toMatch(/(?<![.\w])exec\(/);
  });

  it("健康检查返回前端读取的字段", () => {
    expect(source).toContain("name: \"qingshan-devops-agent\"");
    expect(source).toMatch(/version: VERSION/);
    expect(source).toContain("platform:");
  });

  it("降级路径都带说明文案，不直接抛错", () => {
    expect(source).toContain("Docker daemon 未就绪");
    expect(source).toContain("本轮尚未实现 MySQL 采集");
    expect(source).toContain("没有找到 git 仓库");
  });
});
