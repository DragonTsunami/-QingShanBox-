import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftWarnings,
  importFromContainer,
  loadDrafts,
  newDraft,
  parseCommand,
  renderBuildCommand,
  renderCompose,
  renderDockerfile,
  renderRunCommand,
  renderTarget,
  saveDrafts,
  slug,
  tagFor,
} from "./dockerfile";
import type { DockerContainer } from "./types";

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

describe("Dockerfile 草稿", () => {
  it("默认草稿是一份能直接构建的 Node 服务", () => {
    const draft = newDraft();
    expect(draft.baseImage).toBe("node:22-alpine");
    expect(draft.workdir).toBe("/app");
    expect(tagFor(draft)).toBe("qingshan-api:latest");

    const text = renderDockerfile(draft);
    expect(text.startsWith("# syntax=docker/dockerfile:1")).toBe(true);
    expect(text).toContain("FROM node:22-alpine");
    expect(text).toContain("WORKDIR /app");
    expect(text).toContain("COPY package*.json ./");
    expect(text).toContain("RUN npm ci --omit=dev");
    expect(text).toContain("EXPOSE 8080");
    expect(text).toContain("USER node");
    expect(text).toContain("HEALTHCHECK --interval=30s");
    expect(text).toContain('CMD ["node", "dist/server.js"]');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("按 Dockerfile 的段落顺序输出，多个 RUN 用反斜杠续行", () => {
    const draft = newDraft("demo");
    draft.args = [{ key: "NODE_VERSION", value: "22" }];
    draft.env = [{ key: "PORT", value: "3000" }];
    draft.run = ["apk add --no-cache curl", "npm run build", "rm -rf /root/.npm"];
    draft.volumes = ["/data"];
    draft.labels = [{ key: "team", value: "platform" }];
    draft.entrypoint = "docker-entrypoint.sh";
    draft.cmd = "node server.js";

    const lines = renderDockerfile(draft).split("\n");
    const order = ["ARG NODE_VERSION=22", "FROM node:22-alpine", "ENV PORT=3000", "WORKDIR /app", "COPY package*.json ./", "RUN apk add --no-cache curl \\", " && npm run build \\", " && rm -rf /root/.npm", "EXPOSE 8080", 'VOLUME ["/data"]', "USER node"];
    let cursor = -1;
    for (const expected of order) {
      const index = lines.findIndex((line, position) => position > cursor && line === expected);
      expect(index, `找不到 ${expected}`).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(lines).toContain("LABEL team=platform");
    expect(lines).toContain('ENTRYPOINT ["docker-entrypoint.sh"]');
    expect(lines).toContain('CMD ["node", "server.js"]');
  });

  it("ENV 值里有空格或引号时加双引号", () => {
    const draft = newDraft();
    draft.env = [
      { key: "SIMPLE", value: "abc" },
      { key: "SPACED", value: "a b" },
    ];
    const text = renderDockerfile(draft);
    expect(text).toContain("ENV SIMPLE=abc");
    expect(text).toContain('ENV SPACED="a b"');
  });

  it("healthcheck 已经写成完整指令时不再套一层", () => {
    const draft = newDraft();
    draft.healthcheck = "HEALTHCHECK NONE";
    expect(renderDockerfile(draft)).toContain("HEALTHCHECK NONE");
    expect(renderDockerfile(draft)).not.toContain("HEALTHCHECK --interval");
  });

  it("空的基础镜像会留下占位符，而不是悄悄省略 FROM", () => {
    const draft = newDraft();
    draft.baseImage = "  ";
    expect(renderDockerfile(draft)).toContain("FROM <base-image>");
  });
});

describe("命令与 compose 渲染", () => {
  it("parseCommand 支持 JSON 数组与带引号的分词", () => {
    expect(parseCommand('["node","dist/server.js"]')).toEqual(["node", "dist/server.js"]);
    expect(parseCommand('node -e "console.log(1)"')).toEqual(["node", "-e", "console.log(1)"]);
    expect(parseCommand("  ")).toEqual([]);
  });

  it("普通字符串按空格分词，不会被引号误伤", () => {
    expect(parseCommand("nginx -g daemon off;")).toEqual(["nginx", "-g", "daemon", "off;"]);
  });

  it("build 命令带上构建参数与 tag", () => {
    const draft = newDraft("qingshan-web");
    draft.args = [{ key: "VERSION", value: "1.2.3" }];
    expect(renderBuildCommand(draft)).toBe("docker build -t qingshan-web:latest --build-arg VERSION=1.2.3 .");
  });

  it("run 命令补齐端口映射、数据卷与重启策略", () => {
    const draft = newDraft("qingshan-api");
    draft.ports = ["8080", "9090:9090"];
    draft.volumes = ["/data", "./logs:/app/logs"];
    draft.env = [{ key: "NODE_ENV", value: "production" }];
    const command = renderRunCommand(draft);
    expect(command).toBe(
      "docker run -d --name qingshan-api -p 8080:8080 -p 9090:9090 -v /data:/data -v ./logs:/app/logs -e NODE_ENV=production --restart unless-stopped qingshan-api:latest",
    );
  });

  it("compose 里 service 名用 slug，端口与卷加引号", () => {
    const draft = newDraft("My API Service");
    draft.ports = ["8080"];
    draft.volumes = ["/data"];
    const text = renderCompose(draft);
    expect(slug("My API Service")).toBe("my-api-service");
    expect(text).toContain("  my-api-service:");
    expect(text).toContain('      - "8080:8080"');
    expect(text).toContain('      - "/data:/data"');
    expect(text).toContain("    restart: unless-stopped");
  });

  it("renderTarget 按目标分派", () => {
    const draft = newDraft();
    expect(renderTarget(draft, "dockerfile")).toBe(renderDockerfile(draft));
    expect(renderTarget(draft, "compose")).toBe(renderCompose(draft));
    expect(renderTarget(draft, "run").trim()).toBe(renderRunCommand(draft));
  });
});

describe("完整性提示", () => {
  it("默认草稿没有问题", () => {
    expect(draftWarnings(newDraft())).toEqual([]);
  });

  it("缺基础镜像、缺启动命令、无端口、无构建步骤都会提示", () => {
    const draft = newDraft();
    draft.baseImage = "";
    draft.cmd = "";
    draft.entrypoint = "";
    draft.ports = [];
    draft.copy = [];
    draft.run = [];
    const warnings = draftWarnings(draft);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("基础镜像");
    expect(warnings[1]).toContain("CMD");
    expect(warnings[2]).toContain("端口");
    expect(warnings[3]).toContain("构建步骤");
  });
});

describe("从容器反推草稿", () => {
  const container: DockerContainer = {
    id: "c1",
    name: "api-1",
    image: "registry.qingshan.dev/api:1.4.2",
    state: "running",
    health: "healthy",
    cpuPercent: 3.4,
    memMb: 220,
    memLimitMb: 2048,
    ports: ["0.0.0.0:8080→8080/tcp", "9090/tcp"],
    compose: "qingshan-prod",
    restarts: 0,
    uptime: "Up 2 hours",
    command: "node dist/server.js",
  };

  it("只还原能确定的字段，端口去掉宿主与协议", () => {
    const draft = importFromContainer(container);
    expect(draft.name).toBe("api-1");
    expect(draft.baseImage).toBe("registry.qingshan.dev/api:1.4.2");
    expect(draft.cmd).toBe("node dist/server.js");
    expect(draft.ports).toEqual(["8080", "9090"]);
    expect(draft.labels).toEqual([{ key: "com.docker.compose.project", value: "qingshan-prod" }]);
    expect(draft.env).toEqual([]);
    expect(draft.run).toEqual([]);
    expect(draft.workdir).toBe("");
  });

  it("没有 compose 项目时不写 label", () => {
    const draft = importFromContainer({ ...container, compose: undefined });
    expect(draft.labels).toEqual([]);
  });
});

describe("草稿持久化", () => {
  it("保存后能读回，坏数据被过滤", () => {
    const storage = createStorage();
    vi.stubGlobal("localStorage", storage);
    expect(loadDrafts()).toEqual([]);

    const draft = newDraft("web");
    saveDrafts([draft]);
    expect(loadDrafts()).toEqual([draft]);

    storage.setItem("qingshan.devops.dockerfile.drafts", JSON.stringify([draft, { id: 1 }, null]));
    expect(loadDrafts()).toEqual([draft]);
  });

  it("localStorage 抛异常时降级为空列表", () => {
    vi.stubGlobal("localStorage", {
      ...createStorage(),
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(loadDrafts()).toEqual([]);
    expect(() => saveDrafts([newDraft()])).not.toThrow();
  });
});
