import { describe, expect, it } from "vitest";
import { ansible, docker, git, jenkins, mysql, observability, sources, terraform } from "./fixtures";

describe("数据源快照", () => {
  it("八个数据源齐全且 id 唯一", () => {
    expect(sources).toHaveLength(8);
    expect(new Set(sources.map((item) => item.id)).size).toBe(8);
    for (const item of sources) {
      expect(["up", "down", "degraded", "unknown"]).toContain(item.health);
      expect(Number.isNaN(Date.parse(item.checkedAt))).toBe(false);
    }
  });

  it("Docker：容器名唯一，compose 项目都能对上", () => {
    expect(docker.containers.length).toBeGreaterThan(0);
    expect(new Set(docker.containers.map((item) => item.name)).size).toBe(docker.containers.length);
    const projects = new Set(docker.projects.map((item) => item.name));
    for (const container of docker.containers) {
      if (container.compose) expect(projects.has(container.compose)).toBe(true);
      expect(container.memMb).toBeLessThanOrEqual(container.memLimitMb || container.memMb);
    }
    for (const image of docker.images) {
      expect(image.sizeMb).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(image.created))).toBe(false);
    }
  });

  it("MySQL：实例、慢查询、表空间都有内容", () => {
    expect(mysql.instances.length).toBeGreaterThanOrEqual(3);
    expect(mysql.slowQueries.length).toBeGreaterThan(0);
    expect(mysql.tables.length).toBeGreaterThan(0);
    expect(new Set(mysql.tables.map((item) => `${item.schema}.${item.table}`)).size).toBe(mysql.tables.length);
  });

  it("Terraform：每条变更都属于某个 workspace", () => {
    const names = new Set(terraform.workspaces.map((item) => item.name));
    expect(names.size).toBe(terraform.workspaces.length);
    const entries = Object.entries(terraform.changes);
    expect(entries.some(([, changes]) => changes.length > 0)).toBe(true);
    for (const [workspace, changes] of entries) {
      expect(names.has(workspace)).toBe(true);
      for (const change of changes) {
        expect(["create", "update", "replace", "delete", "read"]).toContain(change.action);
        expect(change.address.length).toBeGreaterThan(0);
      }
    }
  });

  it("Ansible：清单与最近一次运行自洽", () => {
    expect(ansible.hosts.length).toBeGreaterThan(0);
    expect(ansible.playbooks.length).toBeGreaterThan(0);
    expect(ansible.recentRun.tasks.length).toBeGreaterThan(0);
    const failed = ansible.recentRun.tasks.some((item) => item.status === "failed");
    expect(failed).toBe(ansible.recentRun.status === "failed");
  });

  it("Git：提交与分支都挂在真实仓库 id 下", () => {
    const ids = new Set(git.repos.map((item) => item.id));
    expect(ids.size).toBe(git.repos.length);
    for (const [repoId, commits] of Object.entries(git.commits)) {
      expect(ids.has(repoId)).toBe(true);
      expect(commits.length).toBeGreaterThan(0);
      for (const commit of commits) {
        expect(commit.short.length).toBeGreaterThan(0);
        expect(commit.files).toBeGreaterThanOrEqual(0);
      }
    }
    for (const [repoId, branches] of Object.entries(git.branches)) {
      expect(ids.has(repoId)).toBe(true);
      expect(branches.some((item) => item.isDefault)).toBe(true);
    }
  });

  it("Jenkins：构建号唯一、健康度在 0–100", () => {
    expect(jenkins.jobs.length).toBeGreaterThan(0);
    expect(new Set(jenkins.builds.map((item) => `${item.job}#${item.number}`)).size).toBe(jenkins.builds.length);
    for (const job of jenkins.jobs) {
      expect(job.health).toBeGreaterThanOrEqual(0);
      expect(job.health).toBeLessThanOrEqual(100);
      expect(job.history.length).toBeGreaterThan(0);
    }
  });

  it("可观测：时序统计值自洽", () => {
    expect(observability.targets.length).toBeGreaterThan(0);
    expect(observability.series.length).toBeGreaterThan(0);
    for (const item of observability.series) {
      expect(item.points.length).toBeGreaterThan(10);
      expect(item.min).toBeLessThanOrEqual(item.avg);
      expect(item.avg).toBeLessThanOrEqual(item.max);
      expect(item.current).toBeGreaterThanOrEqual(item.min);
      expect(item.current).toBeLessThanOrEqual(item.max);
    }
    expect(observability.alerts.some((item) => item.state === "firing")).toBe(true);
  });
});
