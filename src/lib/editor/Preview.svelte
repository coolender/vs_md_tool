<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { renderTo } from "../markdown/render.ts";
  import { extractOutline } from "../markdown/parser.ts";
  import { outline, activeHeadingId } from "../stores/outline.ts";
  import { doc } from "../stores/doc.ts";
  import { debounce } from "../utils.ts";

  // props
  export let source: string;
  export let mode: "split" | "read" | "edit" = "split";
  export let tabId: string = "";

  let container: HTMLElement;
  let token = 0;
  let scrollEl: HTMLElement;
  let io: IntersectionObserver | null = null;

  // 预览滚动位置缓存：模块级 Map，跨组件生命周期保留，
  // 切标签后回到原标签时恢复阅读位置（与编辑器滚动独立）。
  const previewScrollTops = new Map<string, number>();
  let lastTabId = tabId;
  // 切入新标签后待恢复的滚动位置（渲染完成后应用）
  let pendingRestore: number | null = null;

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
      // 用 textContent 而非 innerHTML，避免异常信息含 HTML 被解析（XSS）
      container.replaceChildren();
      const pre = document.createElement("pre");
      pre.style.color = "var(--danger)";
      pre.style.padding = "1rem";
      pre.textContent = `渲染失败: ${String(e)}`;
      container.appendChild(pre);
    }
    outline.set(extractOutline(src));
    // 渲染后重新挂载标题观察器
    setupHeadingObserver();
    // 若有待恢复的滚动位置，渲染完成后应用
    if (pendingRestore != null && scrollEl) {
      const s = pendingRestore;
      pendingRestore = null;
      // 下一帧应用，确保 DOM 已布局
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = s;
      });
    }
  }, 180);

  // 源码变化 -> 重新渲染
  $: if (container && source !== undefined) schedule(source);

  // 切标签：存出旧标签滚动位置，新标签渲染后恢复
  $: if (scrollEl && tabId !== lastTabId) {
    if (lastTabId) previewScrollTops.set(lastTabId, scrollEl.scrollTop);
    lastTabId = tabId;
    pendingRestore = previewScrollTops.get(tabId) ?? null;
  }

  /**
   * 用 IntersectionObserver 监听预览区内标题元素，找出当前视口内最靠上的标题，
   * 更新 activeHeadingId 供侧栏大纲高亮联动。
   * 阅读模式下以预览滚动容器为 root；分栏模式下预览列自身滚动。
   */
  function setupHeadingObserver() {
    if (!scrollEl || !container) return;
    io?.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        // 收集所有"在视口内"的标题，取最靠上的
        const visible: { id: string; top: number }[] = [];
        const rootTop = scrollEl.getBoundingClientRect().top;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const top = e.boundingClientRect.top - rootTop;
          visible.push({ id: e.target.id, top });
        }
        if (visible.length > 0) {
          visible.sort((a, b) => a.top - b.top);
          activeHeadingId.set(visible[0].id);
        }
      },
      {
        root: scrollEl,
        // 顶部留一线：标题刚滚到视口顶部附近即视为"当前"
        rootMargin: "0px 0px -70% 0px",
        threshold: 0,
      },
    );
    const headings = container.querySelectorAll<HTMLElement>(
      "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
    );
    headings.forEach((h) => io!.observe(h));
  }

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
    // 首次渲染后挂载标题观察器（schedule 是异步的，延一帧确保 container 有内容）
    requestAnimationFrame(setupHeadingObserver);
  });

  onDestroy(() => {
    io?.disconnect();
    io = null;
    // 卸载前存出当前标签滚动位置
    if (lastTabId && scrollEl) previewScrollTops.set(lastTabId, scrollEl.scrollTop);
  });
</script>

<div
  class="preview-scroll"
  class:full={mode === "read"}
  bind:this={scrollEl}
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
