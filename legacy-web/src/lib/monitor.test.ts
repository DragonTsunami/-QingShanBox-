import { describe, expect, it } from "vitest";
import { docker as dockerFixture, jenkins as jenkinsFixture, mysql as mysqlFixture, observability as observabilityFixture } from "../data/fixtures";
import { SAMPLE_WINDOW, buildSample, seriesOf, trendOf, type MonitorSample } from "./monitor";
import type { DockerSnapshot, JenkinsSnapshot, MysqlSnapshot, ObservabilitySnapshot } from "./types";

const docker: DockerSnapshot = dockerFixture;
const mysql: MysqlSnapshot = mysqlFixture;
const jenkins: JenkinsSnapshot = jenkinsFixture;
const observability: ObservabilitySnapshot = observabilityFixture;

function sampleFixture(t: number, value: Partial<MonitorSample> = {}): MonitorSample {
  return {
    t,
    containers: 10,
    running: 9,
    restarts: 2,
    cpu: 100,
    memMb: 4096,
    slowQueries: 50,
    firing: 3,
    queue: 2,
    ...value,
  };
}

describe("采样快照", () => {
  it("从四份快照里取出可展示的数字", () => {
    const sample = buildSample(docker, mysql, jenkins, observability, 1_700_000_000_000);
    const running = docker.containers.filter((item) => item.state === "running");
    expect(sample.t).toBe(1_700_000_000_000);
    expect(sample.containers).toBe(docker.containers.length);
    expect(sample.running).toBe(running.length);
    expect(sample.restarts).toBe(docker.containers.reduce((sum, item) => sum + item.restarts, 0));
    expect(sample.cpu).toBeCloseTo(running.reduce((sum, item) => sum + item.cpuPercent, 0), 1);
    expect(sample.memMb).toBe(Math.round(running.reduce((sum, item) => sum + item.memMb, 0)));
    expect(sample.slowQueries).toBe(mysql.instances.reduce((sum, item) => sum + item.slowQueries, 0));
    expect(sample.firing).toBe(observability.alerts.filter((item) => item.state === "firing").length);
    expect(sample.queue).toBe(jenkins.queue);
  });

  it("空快照也算得出零值", () => {
    const empty = buildSample(
      { containers: [], images: [], projects: [] },
      { instances: [], slowQueries: [], tables: [] },
      { jobs: [], builds: [], nodes: [], queue: 0 },
      { targets: [], alerts: [], dashboards: [], series: [], scrapeIntervalSec: 15 },
      42,
    );
    expect(empty).toEqual({ t: 42, containers: 0, running: 0, restarts: 0, cpu: 0, memMb: 0, slowQueries: 0, firing: 0, queue: 0 });
  });
});

describe("趋势", () => {
  it("没有采样时返回零", () => {
    expect(trendOf([], "cpu")).toEqual({ current: 0, delta: 0, direction: "flat" });
  });

  it("用第一个点做基线，方向跟着差值走", () => {
    const samples = [sampleFixture(1, { cpu: 100 }), sampleFixture(2, { cpu: 103 }), sampleFixture(3, { cpu: 106.5 })];
    expect(trendOf(samples, "cpu")).toEqual({ current: 106.5, delta: 6.5, direction: "up" });

    const down = [sampleFixture(1, { memMb: 4096 }), sampleFixture(2, { memMb: 3900 })];
    expect(trendOf(down, "memMb")).toEqual({ current: 3900, delta: -196, direction: "down" });

    const flat = [sampleFixture(1, { firing: 3 }), sampleFixture(2, { firing: 3 })];
    expect(trendOf(flat, "firing")).toEqual({ current: 3, delta: 0, direction: "flat" });
  });

  it("小数差值保留一位，避免曲线上的 0.3000000000000044", () => {
    const samples = [sampleFixture(1, { cpu: 10.1 }), sampleFixture(2, { cpu: 10.4 })];
    expect(trendOf(samples, "cpu").delta).toBe(0.3);
  });

  it("seriesOf 按采样顺序取值", () => {
    const samples = [sampleFixture(1, { running: 8 }), sampleFixture(2, { running: 9 }), sampleFixture(3, { running: 7 })];
    expect(seriesOf(samples, "running")).toEqual([8, 9, 7]);
    expect(seriesOf([], "running")).toEqual([]);
  });

  it("窗口上限是 30 个点", () => {
    expect(SAMPLE_WINDOW).toBe(30);
  });
});
