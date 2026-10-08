/**
 * 导出 HTML：把当前文档渲染成独立可分享的 HTML 文件。
 *
 * 策略：取已渲染的 prose HTML，内联必要的 CSS（tokens + prose 子集），
 * 加上 <meta charset> 和 viewport，写成一个 .html 文件。
 * 代码高亮（Shiki）已自带内联 style，KaTeX/Mermaid 在导出时降级：
 *   - KaTeX：保留 HTML 结构，内联 KaTeX 样式（从已加载的 <style> 取）
 *   - Mermaid：导出为内联 SVG（若已渲染）或源码块
 */
import { renderHtml } from "./render.ts";
import { theme } from "../theme/theme.ts";
import { isTauri, saveAsFile } from "../tauri/fs.ts";

/** 抓取当前文档已渲染的 prose 容器 HTML（含 Shiki 内联样式） */
function captureProseHtml(src: string): string {
  // 重新渲染一份干净的 HTML（避免抓到运行中的 DOM 改写）
  return renderHtml(src);
}

/** 收集 KaTeX 样式（若已加载） */
function collectKatexCss(): string {
  if (typeof document === "undefined") return "";
  // KaTeX 的样式表 link/style
  const out: string[] = [];
  document
    .querySelectorAll('link[rel="stylesheet"][href*="katex"]')
    .forEach((n) => out.push(`@import url("${(n as HTMLLinkElement).href}");`));
  document
    .querySelectorAll("style")
    .forEach((n) => {
      const t = n.textContent ?? "";
      if (t.includes("katex") || t.includes(".katex")) out.push(t);
    });
  return out.join("\n");
}

/** 内联的导出用 CSS：tokens（亮/暗）+ prose 子集 + 阅读区容器 */
function inlineCss(): string {
  const isDark = theme.resolved === "dark";
  // 直接复用应用运行时的 CSS 变量定义，保证视觉一致
  const rootVars = isDark
    ? `:root{--bg:#0d1117;--fg:#e6edf3;--reading-fg:#e6edf3;--reading-bg:#0d1117;--code-bg:#161b22;--code-fg:#e6edf3;--accent:#58a6ff;--border:#30363d;--border-soft:#21262d;}`
    : `:root{--bg:#ffffff;--fg:#1f2328;--reading-fg:#1f2328;--reading-bg:#ffffff;--code-bg:#f6f8fa;--code-fg:#1f2328;--accent:#0969da;--border:#d0d7de;--border-soft:#e6e8eb;}`;

  return `${rootVars}
body{margin:0;background:var(--reading-bg);color:var(--reading-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:16px;line-height:1.7;}
.reading-col{max-width:780px;margin:0 auto;padding:2rem 1rem 4rem;}
.prose{color:var(--reading-fg);word-wrap:break-word;}
.prose h1,.prose h2,.prose h3,.prose h4,.prose h5,.prose h6{margin:1.8em 0 .6em;font-weight:600;line-height:1.25;}
.prose h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid var(--border-soft);}
.prose h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--border-soft);}
.prose h3{font-size:1.25em;}
.prose p{margin:0 0 1em;}
.prose a{color:var(--accent);text-decoration:none;}
.prose a:hover{text-decoration:underline;}
.prose code{font-family:var(--font-mono,ui-monospace,Consolas,monospace);background:var(--code-bg);color:var(--code-fg);padding:.15em .35em;border-radius:3px;font-size:.9em;}
.prose pre{background:var(--code-bg);color:var(--code-fg);padding:1em;overflow:auto;border-radius:6px;margin:0 0 1em;}
.prose pre code{background:none;padding:0;font-size:.9em;}
.prose blockquote{margin:0 0 1em;padding:0 1em;color:var(--fg-soft,#656d76);border-left:.25em solid var(--border-soft);}
.prose ul,.prose ol{margin:0 0 1em;padding-left:2em;}
.prose li{margin:.25em 0;}
.prose img{max-width:100%;}
.prose table{border-collapse:collapse;margin:0 0 1em;display:block;overflow:auto;}
.prose th,.prose td{border:1px solid var(--border);padding:.4em .8em;}
.prose th{background:var(--code-bg);font-weight:600;}
.prose hr{border:none;border-top:2px solid var(--border-soft);margin:2em 0;}
.prose input[type=checkbox]{margin-right:.4em;}
.prose .mermaid{text-align:center;margin:0 0 1em;}
${collectKatexCss()}`;
}

/** 把字体栈变量也补上（inlineCss 用到 --font-mono） */
function fontVars(): string {
  return `--font-mono:"JetBrains Mono","Cascadia Code",Consolas,monospace;`;
}

/**
 * 导出当前文档为独立 HTML 文件。
 * @param src Markdown 源码
 * @param defaultName 默认文件名（无后缀）
 */
export async function exportHtml(src: string, defaultName: string): Promise<string | null> {
  const body = captureProseHtml(src);
  const css = inlineCss();
  const fontV = fontVars();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(defaultName)}</title>
<style>
:root{${fontV}}
${css}
</style>
</head>
<body>
<div class="reading-col prose">
${body}
</div>
</body>
</html>`;

  const filename = (defaultName.replace(/\.[^.]+$/, "") || "export") + ".html";
  if (isTauri) {
    return saveAsFile(html); // 弹另存为对话框，用户选位置
  }
  // 浏览器：触发下载
  download(html, filename);
  return filename;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function download(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
