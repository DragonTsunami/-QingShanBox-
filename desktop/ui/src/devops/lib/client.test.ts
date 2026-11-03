import { describe, expect, it } from "vitest";
import { ClientError, createClient, createDemoClient, errorText } from "./client";
import { DEFAULT_SETTINGS } from "./store";

describe("演示客户端", () => {
  it("返回 demo 模式与完整快照", async () => {
    const client = createDemoClient();
    expect(client.mode).toBe("demo");
    const docker = await client.docker();
    expect(docker.containers.length).toBeGreaterThan(0);
    const git = await client.git();
    expect(git.repos.length).toBeGreaterThan(0);
  });

  it("每次返回独立副本，页面改动不会污染下一次", async () => {
    const client = createDemoClient();
    const first = await client.docker();
    const original = first.containers.length;
    first.containers.splice(0, first.containers.length);
    first.containers.push({
      id: "broken",
      name: "被改坏的容器",
      image: "x:latest",
      state: "exited",
      health: "none",
      ports: [],
      cpuPercent: 0,
      memMb: 0,
      memLimitMb: 0,
      uptime: "",
      restarts: 0,
    });
    const second = await client.docker();
    expect(second.containers.length).toBe(original);
    expect(second.containers.some((item) => item.name === "被改坏的容器")).toBe(false);
  });

  it("createClient 按 mode 选择实现", () => {
    expect(createClient(DEFAULT_SETTINGS).mode).toBe("demo");
    expect(createClient({ ...DEFAULT_SETTINGS, mode: "agent" }).mode).toBe("agent");
  });
});

describe("错误呈现", () => {
  it("ClientError 保留状态码与文案", () => {
    const error = new ClientError("连不上 agent", 502);
    expect(error.status).toBe(502);
    expect(errorText(error)).toBe("连不上 agent");
  });

  it("普通异常与字符串也能取出文案", () => {
    expect(errorText(new Error("超时"))).toBe("超时");
    expect(errorText("坏了")).toBe("坏了");
    expect(errorText(undefined)).toBe("未知错误");
  });
});
