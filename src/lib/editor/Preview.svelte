<script lang="ts">
  import { onMount } from "svelte";
  import { renderTo } from "../markdown/render.ts";
  import { extractOutline } from "../markdown/parser.ts";
  import { outline } from "../stores/outline.ts";
  import { doc } from "../stores/doc.ts";
  import { debounce } from "../utils.ts";

  // props
  export let source: string;
  export let mode: "split" | "read" | "edit" = "split";

  let container: HTMLElement;
  let token = 0;

  /** 从文档路径取所在目录（用于相对路径图片解析） */
  function docDir(path: string | null): string | null {
    if (!path) return null;
    const slash = path.lastIndexOf("/");
    const back = path.lastIndexOf("\\");
    const i = Math.max(slash, back);
    return i > 0 ? path.slice(0, i) : null;
  }

  const schedule = debounce(async (src: string) => {
    if (!container) return;
    const t = ++token;
    try {
      await renderTo(src, container, docDir($doc.path));
    } catch (e) {
      if (t !== token) return;
      console.error("[Preview] 渲染失败:", e);
      container.innerHTML = `<pre style="color:var(--danger);padding:1rem">渲染失败: ${String(e)}</pre>`;
    }
    outline.set(extractOutline(src));
  }, 180);

  // 源码变化 -> 重新渲染
  $: if (container && source !== undefined) schedule(source);

  /** 点击大纲/锚点跳转：滚动到对应 id */
  export async function scrollToId(id: string) {
    if (!container) return;
    const el = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * 拦截预览区内 <a> 的点击：
   * - 外部链接（http/https/mailto）→ 用系统默认浏览器打开（不在应用内导航）
   * - 锚点链接（#xxx）→ 滚动到预览内对应标题
   * 阻止默认行为，避免 WebView 内跳转导致白屏或异常。
   */
  function handleLinkClick(e: MouseEvent) {
    const a = (e.target as HTMLElement)?.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (!href) {
      e.preventDefault();
      return;
    }
    // 锚点：页内滚动
    if (href.startsWith("#")) {
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const el = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // 外部链接：交给 Tauri shell 打开；浏览器环境用新标签
    if (/^(https?:|mailto:|tel:|ftp:)/i.test(href)) {
      e.preventDefault();
      openExternal(href);
    }
    // 相对路径等不处理（避免在 WebView 内导航）
  }

  async function openExternal(url: string) {
    const isTauriEnv =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (isTauriEnv) {
      try {
        const mod = await import("@tauri-apps/plugin-opener");
        await mod.openUrl(url);
        return;
      } catch {
        /* 插件未装则回退到新标签 */
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  onMount(() => {
    schedule(source);
  });
</script>

<div
  class="preview-scroll"
  class:full={mode === "read"}
  on:click={handleLinkClick}
>
  <div class="prose reading-col" bind:this={container}></div>
</div>

<style>
  .preview-scroll {
    height: 100%;
    overflow-y: auto;
    background: var(--reading-bg);
  }
  /* 阅读模式：内容铺满，不再强制窄列居中 */
  .preview-scroll.full .reading-col {
    max-width: none;
    padding: 2rem clamp(1rem, 4vw, 3rem) 4rem;
  }
  .reading-col {
    max-width: var(--reading-max-width);
    margin: 0 auto;
    padding: 2rem clamp(1rem, 4vw, 3rem) 4rem;
  }
</style>
