import { useCallback, useEffect, useRef, useState } from "react";
import type { DevopsClient, DockerSnapshot, JenkinsSnapshot, MysqlSnapshot, ObservabilitySnapshot } from "./types";

/** 一次采样的结果：只留会在界面上看的数字，避免把整份快照塞进内存。 */
export interface MonitorSample {
  t: number;
  containers: number;
  running: number;
  restarts: number;
  cpu: number;
  memMb: number;
  slowQueries: number;
  firing: number;
  queue: number;
}

export const SAMPLE_WINDOW = 30;

export function buildSample(
  docker: DockerSnapshot,
  mysql: MysqlSnapshot,
  jenkins: JenkinsSnapshot,
  observability: ObservabilitySnapshot,
  t = Date.now(),
): MonitorSample {
  const running = docker.containers.filter((item) => item.state === "running");
  return {
    t,
    containers: docker.containers.length,
    running: running.length,
    restarts: docker.containers.reduce((sum, item) => sum + item.restarts, 0),
    cpu: Math.round(running.reduce((sum, item) => sum + item.cpuPercent, 0) * 10) / 10,
    memMb: Math.round(running.reduce((sum, item) => sum + item.memMb, 0)),
    slowQueries: mysql.instances.reduce((sum, item) => sum + item.slowQueries, 0),
    firing: observability.alerts.filter((item) => item.state === "firing").length,
    queue: jenkins.queue,
  };
}

export type MonitorKey = Exclude<keyof MonitorSample, "t">;

export interface Trend {
  current: number;
  delta: number;
  direction: "up" | "down" | "flat";
}

export function trendOf(samples: MonitorSample[], key: MonitorKey): Trend {
  if (samples.length === 0) return { current: 0, delta: 0, direction: "flat" };
  const current = samples[samples.length - 1][key];
  const first = samples[0][key];
  const delta = Math.round((current - first) * 10) / 10;
  return { current, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

export function seriesOf(samples: MonitorSample[], key: MonitorKey): number[] {
  return samples.map((item) => item[key]);
}

interface MonitorState {
  samples: MonitorSample[];
  error: string | null;
  paused: boolean;
  toggle: () => void;
}

/**
 * 定时采样：10 秒一次，保留最近 30 个点。任何一次失败都不清空已有曲线，只记错误。
 */
export function useMonitor(client: DevopsClient, intervalMs = 10_000): MonitorState {
  const [samples, setSamples] = useState<MonitorSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);

  const collect = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [docker, mysql, jenkins, observability] = await Promise.all([
        client.docker(),
        client.mysql(),
        client.jenkins(),
        client.observability(),
      ]);
      const sample = buildSample(docker, mysql, jenkins, observability);
      setSamples((current) => [...current, sample].slice(-SAMPLE_WINDOW));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "采样失败");
    } finally {
      busy.current = false;
    }
  }, [client]);

  useEffect(() => {
    if (paused) return;
    void collect();
    timer.current = window.setInterval(() => void collect(), intervalMs);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [collect, intervalMs, paused]);

  const toggle = useCallback(() => setPaused((value) => !value), []);

  return { samples, error, paused, toggle };
}
