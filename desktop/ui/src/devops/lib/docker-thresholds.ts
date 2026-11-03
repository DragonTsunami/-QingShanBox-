export interface DockerThresholds {
  /** CPU 合计超过该百分比时告警。 */
  cpu: number;
  /** 内存占用超过该百分比时告警。 */
  memory: number;
  /** 重启次数达到该值时告警。 */
  restarts: number;
  /** 非 running 容器达到该数量时告警。 */
  stopped: number;
}

export const DEFAULT_DOCKER_THRESHOLDS: DockerThresholds = {
  cpu: 70,
  memory: 80,
  restarts: 3,
  stopped: 5,
};

const STORAGE_KEY = "qingshan.workbench.docker.thresholds";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalize(input: Partial<DockerThresholds> | null | undefined): DockerThresholds {
  return {
    cpu: clamp(input?.cpu ?? DEFAULT_DOCKER_THRESHOLDS.cpu, 1, 100),
    memory: clamp(input?.memory ?? DEFAULT_DOCKER_THRESHOLDS.memory, 1, 100),
    restarts: clamp(input?.restarts ?? DEFAULT_DOCKER_THRESHOLDS.restarts, 0, 1000),
    stopped: clamp(input?.stopped ?? DEFAULT_DOCKER_THRESHOLDS.stopped, 0, 10000),
  };
}

function readMap(): Record<string, DockerThresholds> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: Record<string, DockerThresholds> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        map[key] = normalize(value as Partial<DockerThresholds>);
      }
    }
    return map;
  } catch {
    return {};
  }
}

export function loadDockerThresholds(connectionId: string): DockerThresholds {
  return readMap()[connectionId] ?? DEFAULT_DOCKER_THRESHOLDS;
}

export function saveDockerThresholds(connectionId: string, thresholds: DockerThresholds): void {
  try {
    const map = readMap();
    map[connectionId] = normalize(thresholds);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时使用内存态即可 */
  }
}
