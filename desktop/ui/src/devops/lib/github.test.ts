import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSavedRepo,
  createDemoGithub,
  createGithubApi,
  GithubError,
  fullName,
  loadSavedRepos,
  parseRepoRef,
  parseRepoRefs,
  refKey,
  removeSavedRepo,
  repoError,
  saveSavedRepos,
} from "./github";
import type { SavedRepo } from "./github";

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorage());
});

describe("parseRepoRef", () => {
  it("接受 owner/repo", () => {
    expect(parseRepoRef("qingshan/api")).toEqual({ owner: "qingshan", name: "api" });
  });

  it("接受 https 链接、git 地址与 .git 后缀", () => {
    expect(parseRepoRef("https://github.com/vercel/next.js")).toEqual({ owner: "vercel", name: "next.js" });
    expect(parseRepoRef("git@github.com:qingshan/web-console.git")).toEqual({ owner: "qingshan", name: "web-console" });
    expect(parseRepoRef("  github.com/qingshan/api/  ")).toEqual({ owner: "qingshan", name: "api" });
  });

  it("忽略链接后面的子路径、查询串与锚点", () => {
    expect(parseRepoRef("https://github.com/qingshan/api/tree/main/src")).toEqual({ owner: "qingshan", name: "api" });
    expect(parseRepoRef("https://github.com/qingshan/api/blob/main/README.md#L1")).toEqual({
      owner: "qingshan",
      name: "api",
    });
    expect(parseRepoRef("qingshan/api?tab=readme")).toEqual({ owner: "qingshan", name: "api" });
  });

  it("认得 www、ssh 与 http 写法，以及被括号包住的链接", () => {
    expect(parseRepoRef("www.github.com/rust-lang/rust")).toEqual({ owner: "rust-lang", name: "rust" });
    expect(parseRepoRef("http://github.com/facebook/react.git")).toEqual({ owner: "facebook", name: "react" });
    expect(parseRepoRef("ssh://git@github.com/vercel/turbo.git")).toEqual({ owner: "vercel", name: "turbo" });
    expect(parseRepoRef("<https://github.com/vuejs/core>")).toEqual({ owner: "vuejs", name: "core" });
  });

  it("拒绝空串、单段、非 GitHub 与非法字符", () => {
    expect(parseRepoRef("")).toBeNull();
    expect(parseRepoRef("   ")).toBeNull();
    expect(parseRepoRef("qingshan")).toBeNull();
    expect(parseRepoRef("https://gitlab.com/qingshan/api")).toBeNull();
    expect(parseRepoRef("-bad/api")).toBeNull();
    expect(parseRepoRef("qingshan/ap i")).toBeNull();
    expect(parseRepoRef("qingshan/..")).toBeNull();
  });
});

describe("parseRepoRefs", () => {
  it("一次解析多条：换行、空格、逗号、分号都行", () => {
    const { refs, invalid } = parseRepoRefs(
      "https://github.com/qingshan/api\nvercel/next.js，https://github.com/rust-lang/rust;\n\n  vuejs/core  ",
    );
    expect(refs.map((ref) => fullName(ref))).toEqual(["qingshan/api", "vercel/next.js", "rust-lang/rust", "vuejs/core"]);
    expect(invalid).toEqual([]);
  });

  it("去重并回报认不出的片段", () => {
    const { refs, invalid } = parseRepoRefs("qingshan/api QINGSHAN/API gitlab.com/x/y ???");
    expect(refs).toHaveLength(1);
    expect(invalid).toEqual(["gitlab.com/x/y", "???"]);
  });

  it("空输入不报错", () => {
    expect(parseRepoRefs("   \n  ")).toEqual({ refs: [], invalid: [] });
  });
});

describe("已添加仓库的存储", () => {
  const ref = { owner: "qingshan", name: "api" };

  it("按 key 去重，且 key 不区分大小写", () => {
    const first = addSavedRepo([], ref, "public");
    expect(first).toHaveLength(1);
    const second = addSavedRepo(first, { owner: "QINGSHAN", name: "API" }, "public");
    expect(second).toHaveLength(1);
    expect(second[0].kind).toBe("public");
  });

  it("移除时也不区分大小写", () => {
    const repos = addSavedRepo([], ref, "public");
    expect(removeSavedRepo(repos, "QINGSHAN/API")).toHaveLength(0);
  });

  it("往返读写，坏数据被过滤", () => {
    const repos: SavedRepo[] = [{ owner: "vercel", name: "next.js", kind: "public", addedAt: "2026-11-01T00:00:00.000Z" }];
    saveSavedRepos(repos);
    expect(loadSavedRepos()).toEqual(repos);

    localStorage.setItem("qingshan.workbench.github.repos", "not json");
    expect(loadSavedRepos()).toEqual([]);

    localStorage.setItem(
      "qingshan.workbench.github.repos",
      JSON.stringify([{ owner: "ok", name: "repo", kind: "public" }, { owner: "bad/owner", name: "repo" }]),
    );
    const parsed = loadSavedRepos();
    expect(parsed).toHaveLength(1);
    expect(parsed[0].owner).toBe("ok");
  });

  it("工具函数", () => {
    expect(fullName(ref)).toBe("qingshan/api");
    expect(refKey({ owner: "QingShan", name: "API" })).toBe("qingshan/api");
  });
});

describe("演示客户端", () => {
  it("三个仓库的元信息、提交、分支与 README", async () => {
    const api = createDemoGithub();
    const repo = await api.repo({ owner: "vercel", name: "next.js" });
    expect(repo.fullName).toBe("vercel/next.js");
    expect(repo.stars).toBeGreaterThan(100_000);
    expect(repo.defaultBranch).toBe("canary");

    const commits = await api.commits({ owner: "vercel", name: "next.js" }, "canary");
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0].short).toHaveLength(7);

    const branches = await api.branches({ owner: "vercel", name: "next.js" });
    expect(branches.find((branch) => branch.isDefault)?.name).toBe("canary");

    const readme = await api.readme({ owner: "vercel", name: "next.js" }, "canary");
    expect(readme?.text).toContain("# Next.js");
  });

  it("目录与文件能下钻", async () => {
    const api = createDemoGithub();
    const root = await api.contents({ owner: "qingshan", name: "api" }, "", "main");
    expect(root.entries.map((entry) => entry.name)).toContain("README.md");
    expect(root.entries[0].type).toBe("dir");

    const file = await api.contents({ owner: "qingshan", name: "api" }, "package.json", "main");
    expect(file.file?.text).toContain("@qingshan/api");
    expect(file.entries).toHaveLength(0);
  });

  it("没见过的仓库返回合成数据而不是报错", async () => {
    const api = createDemoGithub();
    const repo = await api.repo({ owner: "someone", name: "unknown-repo" });
    expect(repo.fullName).toBe("someone/unknown-repo");
    expect(repo.description).toContain("演示模式");
  });

  it("常见公开库给的是像样的元信息与 README", async () => {
    const api = createDemoGithub();
    const rust = await api.repo({ owner: "rust-lang", name: "rust" });
    expect(rust.language).toBe("Rust");
    expect(rust.stars).toBeGreaterThan(90_000);
    expect(rust.description).toContain("reliable");

    const readme = await api.readme({ owner: "rust-lang", name: "rust" }, "master");
    expect(readme?.text).toContain("# rust");

    const root = await api.contents({ owner: "vuejs", name: "core" }, "", "main");
    expect(root.entries.map((entry) => entry.name)).toContain("README.md");
  });

  it("速率固定按未登录的 60 次算", async () => {
    const api = createDemoGithub();
    expect((await api.rate())?.limit).toBe(60);
  });
});

describe("真实客户端的错误映射", () => {
  const respond = (status: number, body: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response;

  it("401 / 404 / 403 各自给出中文提示", async () => {
    const denied = createGithubApi(async () => respond(401, { message: "Requires authentication" }));
    await expect(denied.repo({ owner: "a", name: "b" })).rejects.toMatchObject({ kind: "auth", status: 401 });

    const missing = createGithubApi(async () => respond(404, { message: "Not Found" }));
    await expect(missing.repo({ owner: "a", name: "b" })).rejects.toMatchObject({ kind: "notfound", status: 404 });

    const limited = createGithubApi(async () => respond(403, { message: "API rate limit exceeded" }));
    await expect(limited.commits({ owner: "a", name: "b" }, "main")).rejects.toMatchObject({ kind: "rate" });
  });

  it("网络异常映射成 network", async () => {
    const api = createGithubApi(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(api.repo({ owner: "a", name: "b" })).rejects.toMatchObject({ kind: "network" });
  });

  it("请求不带 Authorization，只发必要的头", async () => {
    let captured: RequestInit | undefined;
    const api = createGithubApi(async (_input, init) => {
      captured = init;
      return respond(200, { name: "b", full_name: "a/b", owner: { login: "a" }, default_branch: "main" });
    });
    await api.repo({ owner: "a", name: "b" });
    const headers = (captured?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/vnd.github+json");
  });

  it("成功时把 GitHub 的字段翻译成页面用的结构", async () => {
    const api = createGithubApi(async (input) => {
      const url = String(input);
      if (url.includes("/readme")) {
        return respond(200, {
          path: "README.md",
          content: "IyBIaQo=",
          size: 6,
          html_url: "https://github.com/a/b/blob/main/README.md",
        });
      }
      return respond(200, {
        name: "b",
        full_name: "a/b",
        owner: { login: "a" },
        description: "示例",
        stargazers_count: 7,
        forks_count: 2,
        open_issues_count: 1,
        default_branch: "main",
        topics: ["demo"],
        html_url: "https://github.com/a/b",
        updated_at: "2026-11-01T00:00:00Z",
        pushed_at: "2026-11-01T01:00:00Z",
        language: "Rust",
      });
    });
    const repo = await api.repo({ owner: "a", name: "b" });
    expect(repo.fullName).toBe("a/b");
    expect(repo.stars).toBe(7);
    expect(repo.topics).toEqual(["demo"]);

    const readme = await api.readme({ owner: "a", name: "b" }, "main");
    expect(readme?.text).toBe("# Hi\n");
    expect(readme?.binary).toBe(false);
  });

  it("发行版与附件映射", async () => {
    const api = createGithubApi(async (input) => {
      expect(String(input)).toContain("/releases");
      return respond(200, [
        {
          id: 9,
          tag_name: "v1.0.0",
          name: "v1.0.0",
          body: "首个正式版",
          draft: false,
          prerelease: false,
          published_at: "2026-11-01T00:00:00Z",
          html_url: "https://github.com/a/b/releases/tag/v1.0.0",
          assets: [
            {
              name: "QingshanToolbox-v1.0.0-win-x64.zip",
              size: 3642352,
              download_count: 128,
              content_type: "application/zip",
              browser_download_url: "https://github.com/a/b/releases/download/v1.0.0/QingshanToolbox.zip",
            },
          ],
        },
      ]);
    });
    const releases = await api.releases({ owner: "a", name: "b" });
    expect(releases[0].tagName).toBe("v1.0.0");
    expect(releases[0].assets[0].name).toContain("QingshanToolbox");
    expect(releases[0].assets[0].size).toBe(3642352);
    expect(releases[0].assets[0].downloadCount).toBe(128);
  });

  it("repoError 对未知异常兜底", () => {
    expect(repoError(new Error("boom")).message).toBe("boom");
    expect(repoError("nope").message).toBe("未知错误");
    const info = repoError(new GithubError("rate", "限流", "等一会儿"));
    expect(info).toEqual({ message: "限流", hint: "等一会儿" });
  });
});
