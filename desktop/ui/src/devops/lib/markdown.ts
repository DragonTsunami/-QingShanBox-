/**
 * 极简 Markdown 解析：只覆盖 README 里常见的几种块（标题、段落、代码块、
 * 列表、引用、分隔线）与行内的代码、粗体、链接。
 *
 * 刻意不用 dangerouslySetInnerHTML —— 仓库里的 README 来自外部，
 * 解析成结构再由 React 渲染，链接也只会出现在已知的安全元素上。
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*```(.*)$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** 行内解析：`code`、**bold**、[text](url)、![alt](url)。 */
export function parseInline(source: string): Inline[] {
  const result: Inline[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      result.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 0) {
        flush();
        result.push({ kind: "code", text: rest.slice(1, end) });
        index += end + 1;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end > 0) {
        flush();
        result.push({ kind: "bold", text: rest.slice(2, end) });
        index += end + 2;
        continue;
      }
    }

    if (rest.startsWith("![")) {
      const match = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
      if (match) {
        flush();
        result.push({ kind: "link", text: match[1] || match[2], href: match[2] });
        index += match[0].length;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const match = /^\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
      if (match) {
        flush();
        result.push({ kind: "link", text: match[1] || match[2], href: match[2] });
        index += match[0].length;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flush();
  return result;
}

/** 块级解析。空行分段；未闭合的代码块按到文末处理。 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      const text = paragraph.join(" ").trim();
      if (text) blocks.push({ kind: "paragraph", text });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1].trim().split(/\s+/)[0] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language, text: code.join("\n") });
      continue;
    }

    if (isBlank(line)) {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const parts = [quote[1]];
      while (index + 1 < lines.length && QUOTE.test(lines[index + 1])) {
        index += 1;
        parts.push(QUOTE.exec(lines[index])![1]);
      }
      blocks.push({ kind: "quote", text: parts.join(" ").trim() });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = /\d/.test(item[2]);
      const items = [item[3]];
      while (index + 1 < lines.length) {
        const next = LIST_ITEM.exec(lines[index + 1]);
        if (!next) break;
        if (/\d/.test(next[2]) !== ordered) break;
        index += 1;
        items.push(next[3]);
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/** 只提标题，用于 README 顶部的「章节」提示。 */
export function markdownHeadings(blocks: Block[]): { level: number; text: string }[] {
  return blocks
    .filter((block): block is Extract<Block, { kind: "heading" }> => block.kind === "heading")
    .map((block) => ({ level: block.level, text: block.text }));
}
