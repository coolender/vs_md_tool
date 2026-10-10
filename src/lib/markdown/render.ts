import { md, ensureHighlighter, setDocDir } from "./parser.ts";
import { theme } from "../theme/theme.ts";

/**
 * 渲染流水线：
 * 1. md.render(src) -> HTML（Shiki 高亮在 highlighter 就绪后同步执行）
 * 2. 写入预览容器
 * 3. 异步后处理：
 *    a. 本地图片路径 → asset 协议 URL（convertFileSrc）
 *    b. Mermaid.run（仅在含 .mermaid 占位时懒加载）
 */

let mermaidReady: Promise<typeof import("mermaid")> | null = null;

async function ensureMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidReady) {
    mermaidReady = (async () => {
      const mod = await import("mermaid");
      mod.default.initialize({
        startOnLoad: false,
        theme: theme.resolved === "dark" ? "dark" : "default",
        securityLevel: "strict",
      });
      return mod;
    })();
  }
  return mermaidReady;
}

/** 主题切换后重置 Mermaid 主题（需重新渲染已存在的图） */
export async function resetMermaidTheme() {
  if (!mermaidReady) return;
  const mod = await ensureMermaid();
  mod.default.initialize({
    startOnLoad: false,
    theme: theme.resolved === "dark" ? "dark" : "default",
    securityLevel: "strict",
  });
}

/** 同步渲染 Markdown -> HTML 字符串 */
export function renderHtml(src: string): string {
  return md.render(src);
}

/** 是否 Tauri 桌面环境 */
function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let _convertFileSrc: ((p: string, protocol?: string) => string) | null = null;
async function getConvertFileSrc() {
  if (!_convertFileSrc) {
    const mod = await import("@tauri-apps/api/core");
    _convertFileSrc = mod.convertFileSrc;
  }
  return _convertFileSrc;
}

const REMOTE_RE = /^(https?:|data:|blob:|asset:)/i;

/** 解析相对路径：基于当前文档所在目录 */
function resolveRelative(docDir: string | null, rel: string): string | null {
  if (!docDir) return null;
  // Windows：拼接目录 + 相对路径
  const sep = docDir.includes("\\") ? "\\" : "/";
  const base = docDir.replace(/[\\/]+$/, "");
  return base + sep + rel.replace(/^\.\//, "");
}

/** 异步把容器内本地图片 src 改写为 asset 协议 URL */
async function rewriteLocalImages(container: HTMLElement, docDir: string | null) {
  if (!isTauriEnv()) return;
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  if (imgs.length === 0) return;
  const convert = await getConvertFileSrc();
  for (const img of imgs) {
    let src = img.getAttribute("src") ?? "";
    if (!src || REMOTE_RE.test(src)) continue;
    let abs: string | null = null;
    if (/^[A-Za-z]:[\\/]/.test(src)) {
      abs = src; // Windows 绝对
    } else if (src.startsWith("/")) {
      abs = src; // POSIX 绝对（Tauri 会处理）
    } else {
      abs = resolveRelative(docDir, src);
    }
    if (abs) {
      try {
        img.src = convert(abs);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 渲染到指定容器，并执行异步后处理（Shiki 高亮增强 + 本地图片 + Mermaid）。
 * 策略：先立即渲染基础 HTML（代码块走纯文本兜底，保证可见），
 *       再异步加载 Shiki 补高亮、改写本地图片路径、Mermaid 渲图。
 *       任一异步步骤失败不影响基础渲染。
 * @param src 源码
 * @param container 预览区 DOM
 * @param docDir 当前文档所在目录（用于相对路径图片解析）
 */
export async function renderTo(
  src: string,
  container: HTMLElement,
  docDir: string | null = null,
) {
  setDocDir(docDir);

  // 1. 立即渲染基础 HTML
  container.innerHTML = renderHtml(src);

  // 2. 异步增强：Shiki 语法高亮
  try {
    await ensureHighlighter();
    const html = renderHtml(src);
    if (container.innerHTML !== html) container.innerHTML = html;
  } catch (e) {
    console.error("[render] Shiki 加载失败，代码块将无高亮:", e);
  }

  // 3. 本地图片路径 → asset 协议 URL
  try {
    await rewriteLocalImages(container, docDir);
  } catch (e) {
    console.error("[render] 本地图片改写失败:", e);
  }

  // 4. Mermaid：仅当存在占位时才懒加载并运行
  const mermaidNodes = container.querySelectorAll<HTMLElement>(".mermaid");
  if (mermaidNodes.length > 0) {
    const nodes = Array.from(mermaidNodes);
    const mod = await ensureMermaid();
    // 逐个渲染：单个图的语法错误不影响其它图。
    // mermaid.run 对单图语法错误会在该节点内显示错误信息（不抛异常），
    // 仅在 JS 层面异常（如初始化失败）时才 reject。
    for (const n of nodes) {
      const src = n.getAttribute("data-source") ?? "";
      try {
        n.removeAttribute("data-processed");
        // 用 textContent 而非 innerHTML 设置源码——mermaid.run 读取文本内容，
        // 用 innerHTML 会让含 HTML 的恶意源码（如 <img onerror=...>）被解析执行。
        n.textContent = src;
        await mod.default.run({ nodes: [n] });
      } catch (e) {
        console.error("[render] Mermaid 渲染失败:", e, "\n源码:\n", src);
        // 错误兜底：转义源码后再注入，避免 XSS
        n.textContent = `Mermaid 渲染失败:\n${src}`;
        n.className = "mermaid-error";
        n.setAttribute(
          "style",
          "color:var(--danger, #d33);padding:0.6em;border:1px dashed currentColor;border-radius:4px;white-space:pre-wrap",
        );
      }
    }
  }
}
