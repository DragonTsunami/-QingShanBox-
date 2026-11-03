import { describe, expect, it } from "vitest";
import { markdownHeadings, parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("标题与段落", () => {
    const blocks = parseMarkdown("# 青衫 API\n\n订单与库存。\n第二行仍然属于同一段。\n");
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "青衫 API" });
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "订单与库存。 第二行仍然属于同一段。" });
  });

  it("代码块保留原始缩进与语言标记", () => {
    const blocks = parseMarkdown("```bash\nnpm ci\n  npm run dev\n```");
    expect(blocks).toEqual([{ kind: "code", language: "bash", text: "npm ci\n  npm run dev" }]);
  });

  it("未闭合的代码块读到文末", () => {
    const blocks = parseMarkdown("```\na\nb");
    expect(blocks[0]).toEqual({ kind: "code", language: "", text: "a\nb" });
  });

  it("无序与有序列表分开收集", () => {
    const blocks = parseMarkdown("- 一个\n- 两个\n\n1. 先做\n2. 再做\n");
    expect(blocks[0]).toEqual({ kind: "list", ordered: false, items: ["一个", "两个"] });
    expect(blocks[1]).toEqual({ kind: "list", ordered: true, items: ["先做", "再做"] });
  });

  it("引用与分隔线", () => {
    const blocks = parseMarkdown("> 发布前跑一遍测试\n> 构建会卡住\n\n---\n");
    expect(blocks[0]).toEqual({ kind: "quote", text: "发布前跑一遍测试 构建会卡住" });
    expect(blocks[1]).toEqual({ kind: "rule" });
  });

  it("CRLF 与多余空行不影响结果", () => {
    const blocks = parseMarkdown("## 标题\r\n\r\n\r\n正文\r\n");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "标题" },
      { kind: "paragraph", text: "正文" },
    ]);
  });

  it("markdownHeadings 只挑标题", () => {
    const blocks = parseMarkdown("# A\n正文\n## B\n### C\n");
    expect(markdownHeadings(blocks)).toEqual([
      { level: 1, text: "A" },
      { level: 2, text: "B" },
      { level: 3, text: "C" },
    ]);
  });
});

describe("parseInline", () => {
  it("代码、粗体与链接混排", () => {
    expect(parseInline("跑 `npm ci`，然后看 **文档** 里的 [链接](https://example.com/x)。")).toEqual([
      { kind: "text", text: "跑 " },
      { kind: "code", text: "npm ci" },
      { kind: "text", text: "，然后看 " },
      { kind: "bold", text: "文档" },
      { kind: "text", text: " 里的 " },
      { kind: "link", text: "链接", href: "https://example.com/x" },
      { kind: "text", text: "。" },
    ]);
  });

  it("图片退化成链接，保留描述作为文字", () => {
    expect(parseInline("![构建状态](https://img.example.com/badge.svg)")).toEqual([
      { kind: "link", text: "构建状态", href: "https://img.example.com/badge.svg" },
    ]);
  });

  it("未闭合的标记原样保留", () => {
    expect(parseInline("`没闭合")).toEqual([{ kind: "text", text: "`没闭合" }]);
    expect(parseInline("[文字](缺右括号")).toEqual([{ kind: "text", text: "[文字](缺右括号" }]);
  });
});
