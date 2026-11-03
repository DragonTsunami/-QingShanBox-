import { describe, expect, it } from "vitest";
import { ACTION_IDS, ACTION_REGISTRY, commandPreview } from "./actions";

describe("可执行动作白名单", () => {
  it("每个动作 id 与登记表一致", () => {
    for (const id of ACTION_IDS) {
      expect(ACTION_REGISTRY[id].id).toBe(id);
      expect(ACTION_REGISTRY[id].label.length).toBeGreaterThan(0);
      expect(ACTION_REGISTRY[id].impact.length).toBeGreaterThan(0);
    }
    expect(ACTION_IDS).toEqual(["docker.restart", "docker.start", "docker.stop", "git.fetch", "git.pull", "jenkins.build"]);
  });

  it("命令预览与 agent 实际执行的第一条命令一致", () => {
    expect(commandPreview("docker.restart", "qingshan-api-1")).toBe("docker restart qingshan-api-1");
    expect(commandPreview("docker.stop", "qingshan-api-1")).toBe("docker stop qingshan-api-1");
    expect(commandPreview("git.fetch", "D:\\work\\qingshan")).toBe('git -C "D:\\work\\qingshan" fetch --prune');
    expect(commandPreview("git.pull", "D:\\work\\qingshan")).toBe('git -C "D:\\work\\qingshan" pull --ff-only');
    expect(commandPreview("jenkins.build", "qingshan-api", "https://ci.qingshan.dev/")).toBe(
      "POST https://ci.qingshan.dev/job/qingshan-api/build",
    );
    expect(commandPreview("jenkins.build", "qingshan-api")).toBe("POST https://<jenkins>/job/qingshan-api/build");
  });

  it("容器名不接受空格、分号与斜杠", () => {
    const validate = ACTION_REGISTRY["docker.restart"].validate;
    expect(validate("qingshan-api-1")).toBe(true);
    expect(validate("-leading-dash")).toBe(false);
    expect(validate("api; rm -rf /")).toBe(false);
    expect(validate("a/b")).toBe(false);
    expect(validate("")).toBe(false);
  });

  it("仓库路径不接受引号与换行", () => {
    const validate = ACTION_REGISTRY["git.pull"].validate;
    expect(validate("D:\\work\\qingshan")).toBe(true);
    expect(validate('D:\\work\\qing"shan')).toBe(false);
    expect(validate("D:\\work\nqingshan")).toBe(false);
  });

  it("流水线名只允许字母数字与 . _ -", () => {
    const validate = ACTION_REGISTRY["jenkins.build"].validate;
    expect(validate("qingshan-api")).toBe(true);
    expect(validate("qingshan api")).toBe(false);
    expect(validate("../job")).toBe(false);
  });

  it("危险动作标红，其余不动", () => {
    expect(ACTION_REGISTRY["docker.restart"].danger).toBe(true);
    expect(ACTION_REGISTRY["docker.stop"].danger).toBe(true);
    expect(ACTION_REGISTRY["git.pull"].danger).toBe(false);
    expect(ACTION_REGISTRY["jenkins.build"].danger).toBe(false);
  });
});
