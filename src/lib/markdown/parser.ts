import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import katexPlugin from "@vscode/markdown-it-katex";
import { createHighlighter, type Highlighter } from "shiki";
import { theme } from "../theme/theme.ts";

/**
 * Markdown 解析器（单例）。
 * 集成：Shiki 语法高亮、KaTeX 数学公式、Mermaid 占位、任务列表、标题锚点。
 */

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

/** 按需注册的常用语言（控制体积） */
const LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "sql",
  "json",
  "yaml",
  "html",
  "css",
  "bash",
  "markdown",
  "shell",
  "docker",
  "diff",
];

/** 创建 Shiki highlighter（仅一次）。用 createHighlighter 自动选 JS 引擎，免 WASM。 */
export async function ensureHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = (async () => {
    highlighter = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: LANGS,
    });
    return highlighter;
  })();

  return highlighterPromise;
}

function currentThemeName(): "github-light" | "github-dark" {
  return theme.resolved === "dark" ? "github-dark" : "github-light";
}

/** 同步高亮（highlighter 已就绪时）；未就绪或抛错返回转义纯文本兜底 */
function highlight(code: string, lang: string): string {
  if (highlighter) {
    try {
      return highlighter.codeToHtml(code, {
        lang: lang || "text",
        theme: currentThemeName(),
      });
    } catch {
      /* 未知语言，走兜底 */
    }
  }
  return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const md: MarkdownIt = MarkdownIt({
  html: false, // 禁用原始 HTML（安全 + 简单）
  linkify: true,
  breaks: false,
  typographer: true,
  highlight,
});

// 标题锚点（生成 id，供大纲跳转）
md.use(anchor, {
  permalink: false,
  slugify: (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w一-龥\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-"),
});

// 任务列表
md.use(taskLists, { enabled: true, label: true });

// KaTeX 数学公式（$...$ 行内，$$...$$ 块级）
md.use(katexPlugin.default ?? katexPlugin, {
  throwOnError: false,
  errorColor: "#cf222e",
});

/**
 * 本地图片路径改写：把 ![](C:\path\img.png) / ![](/abs/path.png) / ![](./rel.png)
 * 转成 Tauri asset 协议 URL（https://asset.localhost/...），让 WebView 能加载本地图片。
 * - 绝对路径（Win 盘符 / POSIX /）→ convertFileSrc
 * - 相对路径（./ ../ 或无前缀）→ 相对当前文档所在目录解析后 convertFileSrc
 * - http(s): / data: / blob: / asset: 开头 → 原样不动
 * 浏览器（非 Tauri）环境回退：仅 http(s)/data/blob 能显示，本地路径保持原样。
 */
function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let _convertFileSrc: ((p: string, protocol?: string) => string) | null = null;
async function convertFileSrcAsync(p: string): Promise<string> {
  if (!_convertFileSrc) {
    const mod = await import("@tauri-apps/api/core");
    _convertFileSrc = mod.convertFileSrc;
  }
  return _convertFileSrc(p);
}

/** 同步判定 + 异步改写：渲染后异步替换 img.src */
const IMAGE_SRC_RE = /^(https?:|data:|blob:|asset:)/i;
function isRemoteOrData(src: string): boolean {
  return IMAGE_SRC_RE.test(src.trim());
}
function isWindowsAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}
function isPosixAbsolute(p: string): boolean {
  return p.startsWith("/");
}

// 缓存当前文档所在目录，用于相对路径解析
let currentDocDir: string | null = null;
export function setDocDir(dir: string | null) {
  currentDocDir = dir;
}

// 同步版本：render 时先标记所有需要改写的 img，渲染后异步处理
// 这里用渲染后扫描 DOM 的方式（更稳妥，见 render.ts）

/**
 * Mermaid：把 ```mermaid 代码块渲染为 <div class="mermaid"> 占位，
 * 由 render.ts 在挂载后异步调用 mermaid.run()。
 * 用自定义 fence 规则覆盖默认。
 */
const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim();
  if (info === "mermaid") {
    const source = token.content;
    return `<div class="mermaid" data-source="${escapeHtml(source)}">${escapeHtml(source)}</div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export { md };

/** 从 tokens 抽取标题大纲（含源码行号） */
export function extractOutline(src: string) {
  const tokens = md.parse(src, {});
  const items: { level: number; text: string; id: string; line: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") {
      const level = Number(t.tag.slice(1));
      const inline = tokens[i + 1];
      const text = inline?.content ?? "";
      const id = slugifyHeading(text);
      const line = t.map ? t.map[0] : 0;
      items.push({ level, text, id, line });
    }
  }
  return items;
}

function slugifyHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w一-龥\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
