import { describe, expect, it } from "vitest";
import { docker, git, jenkins, mysql, observability } from "../data/fixtures";
import { DEFAULT_SETTINGS } from "./store";
import { consistencyLabel, deriveWorkbench } from "./workbench";

const model = deriveWorkbench({ docker, git, jenkins, observability, mysql, settings: DEFAULT_SETTINGS });

describe("deriveWorkbench", () => {
  it("默认挑容器最多的 compose 项目", () => {
    expect(model.project?.name).toBe("qingshan-prod");
  });

  it("把项目名对到仓库与流水线", () => {
    expect(model.repo?.name).toBe("qingshan");
    expect(model.job?.name).toBe("qingshan-api");
  });

  it("发布链按提交、构建、镜像、运行的顺序排", () => {
    expect(model.links.map((link) => link.key)).toEqual(["commit", "build", "image", "runtime"]);
    for (const link of model.links) {
      expect(link.value.length).toBeGreaterThan(0);
    }
  });

  it("构建用的 commit 落后 HEAD 时报版本不一致", () => {
    expect(model.consistency.state).toBe("warn");
    expect(model.consistency.detail).toContain("b71e0d4");
    expect(model.consistency.detail).toContain("3f9c2a1");
    expect(consistencyLabel(model.consistency.state).text).toBe("版本不一致");
  });

  it("待处理里包含版本落后、告警与 git 落后", () => {
    const ids = model.pending.map((item) => item.id);
    expect(ids).toContain("version");
    expect(ids).toContain("alert:ApiHighErrorRate");
    expect(ids).toContain("git:qingshan");
    expect(model.pending.length).toBeLessThanOrEqual(8);
  });

  it("待处理按严重程度排序", () => {
    const order = { err: 0, warn: 1, idle: 2, ok: 3 };
    const tones = model.pending.map((item) => order[item.tone]);
    expect([...tones].sort((a, b) => a - b)).toEqual(tones);
  });

  it("快捷动作覆盖构建、拉取、重启与 Dockerfile", () => {
    const runs = model.actions.filter((item) => item.kind === "run");
    const ids = runs.map((item) => (item.kind === "run" ? item.id : ""));
    expect(ids).toContain("jenkins.build");
    expect(ids).toContain("git.pull");
    expect(ids).toContain("docker.restart");
    expect(model.actions.some((item) => item.kind === "link" && item.page === "dockerfile")).toBe(true);
  });

  it("可以在上下文条里换一个项目", () => {
    const other = deriveWorkbench({
      docker,
      git,
      jenkins,
      observability,
      mysql,
      settings: DEFAULT_SETTINGS,
      project: "qingshan-observability",
    });
    expect(other.project?.name).toBe("qingshan-observability");
  });

  it("空快照也能给出结构完整的模型", () => {
    const empty = deriveWorkbench({
      docker: { ...docker, containers: [], images: [], projects: [], note: "Docker daemon 未就绪" },
      git: { ...git, repos: [], commits: {}, branches: {} },
      jenkins: { ...jenkins, jobs: [], builds: [], nodes: [], queue: 0 },
      observability: { ...observability, alerts: [], targets: [], dashboards: [], series: [] },
      mysql: { ...mysql, instances: [], slowQueries: [], tables: [] },
      settings: DEFAULT_SETTINGS,
    });
    expect(empty.project).toBeNull();
    expect(empty.repo).toBeNull();
    expect(empty.links).toHaveLength(4);
    expect(empty.links.every((link) => link.tone === "idle")).toBe(true);
    expect(empty.consistency.state).toBe("unknown");
    expect(empty.pending.some((item) => item.id === "docker-empty")).toBe(true);
    expect(empty.actions).toHaveLength(1);
  });
});
