import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, ENV_LABEL, loadSettings, saveSettings } from "./store";

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("设置持久化", () => {
  it("没有存储时返回默认值", () => {
    vi.stubGlobal("localStorage", createStorage());
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("保存后能原样读回", () => {
    vi.stubGlobal("localStorage", createStorage());
    const next = { ...DEFAULT_SETTINGS, mode: "agent" as const, env: "staging" as const, agentUrl: "http://127.0.0.1:9000" };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("坏 JSON 与缺字段都回落到默认值", () => {
    const storage = createStorage();
    storage.setItem("qingshan.devops.settings", "{ 不是 json");
    vi.stubGlobal("localStorage", storage);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    storage.setItem("qingshan.devops.settings", JSON.stringify({ mode: "乱写", env: "qa", endpoints: { docker: "unix:///var/run/docker.sock" } }));
    const loaded = loadSettings();
    expect(loaded.mode).toBe("demo");
    expect(loaded.env).toBe("prod");
    expect(loaded.agentUrl).toBe(DEFAULT_SETTINGS.agentUrl);
    expect(loaded.endpoints.docker).toBe("unix:///var/run/docker.sock");
    expect(loaded.endpoints.grafana).toBe(DEFAULT_SETTINGS.endpoints.grafana);
  });

  it("localStorage 抛异常时不影响页面", () => {
    vi.stubGlobal("localStorage", {
      ...createStorage(),
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("环境标签齐全", () => {
    expect(ENV_LABEL).toEqual({ dev: "开发", staging: "预发", prod: "生产" });
  });

  it("modules 默认关掉 Terraform 与 Ansible，旧数据也能迁移", () => {
    vi.stubGlobal("localStorage", createStorage());
    expect(loadSettings().modules).toEqual({ terraform: false, ansible: false });

    const storage = createStorage();
    storage.setItem("qingshan.devops.settings", JSON.stringify({ mode: "demo", modules: { terraform: true } }));
    vi.stubGlobal("localStorage", storage);
    expect(loadSettings().modules).toEqual({ terraform: true, ansible: false });
  });
});
