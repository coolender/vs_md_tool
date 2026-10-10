<script lang="ts">
  import { onMount } from "svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import TabBar from "./lib/components/TabBar.svelte";
  import StatusBar from "./lib/components/StatusBar.svelte";
  import EditorPane from "./lib/editor/EditorPane.svelte";
  import Sidebar from "./lib/sidebar/Sidebar.svelte";
  import { mode } from "./lib/stores/mode.ts";
  import { doc, markSaved, openNew, openFileInTab, closeTab, cycleTab, anyDirty, dirtyTabs, activeId } from "./lib/stores/doc.ts";
  import { theme } from "./lib/theme/theme.ts";
  import { ensureHighlighter } from "./lib/markdown/parser.ts";
  import { resetMermaidTheme } from "./lib/markdown/render.ts";
  import { openFile, saveFile, isTauri, isMobile } from "./lib/tauri/fs.ts";
  import { pushRecent } from "./lib/stores/recent.ts";
  import { loadSettings, updateSettings, settings } from "./lib/stores/settings.ts";
  import { loadThemePrefs } from "./lib/stores/themePrefs.ts";
  import { loadBookmarks } from "./lib/stores/bookmarks.ts";
  import { startFileWatcher } from "./lib/stores/fileWatch.ts";
  import { listDrafts } from "./lib/stores/drafts.ts";
  import { restoreDrafts } from "./lib/stores/doc.ts";
  import { get } from "svelte/store";
  import { tr } from "./lib/i18n/index.ts";

  let editorPaneRef: any;

  // 预加载 Shiki（不阻塞首屏）
  onMount(() => {
    void ensureHighlighter();
    void loadSettings();
    void loadThemePrefs();
    void loadBookmarks();
    setupCloseGuard();
    setupShortcuts();
    setupSingleInstanceListener();
    setupMobileIntentListener();
    restoreSession();
    openStartupFile();
    // 文件外部变动检测：移动端沙盒语义不同，暂不启用轮询
    if (!isMobile) startFileWatcher();
  });

  // 主题变化 -> 重置 Mermaid 主题
  let lastTheme = $theme;
  $: if ($theme !== lastTheme) {
    lastTheme = $theme;
    void resetMermaidTheme();
  }

  function toggleSidebar() {
    updateSettings({ sidebarVisible: !$settings.sidebarVisible });
  }

  // 关闭前未保存提示（Tauri）：三选一——保存并关闭 / 不保存 / 取消
  async function setupCloseGuard() {
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      win.onCloseRequested(async (e) => {
        if (!anyDirty()) return;
        e.preventDefault();
        const dirty = dirtyTabs();
        const choice = await askCloseChoice(dirty.length);
        if (choice === "cancel") return; // 留在编辑
        if (choice === "save") {
          const ok = await saveAllDirty(dirty);
          if (!ok) return; // 保存失败则不关闭，让用户处理
        }
        // choice === "discard" 或保存成功 → 关闭
        await win.destroy();
      });
    } catch {
      /* ignore */
    }
  }

  /** 关闭前三选一对话框：保存 / 不保存 / 取消。
   *  浏览器原生只有 confirm（两按钮），用两次 confirm 串联实现三选项。 */
  async function askCloseChoice(n: number): Promise<"save" | "discard" | "cancel"> {
    // 第一问：保存并关闭？
    const msg = tr("dialog.closeConfirm.message", n);
    if (window.confirm(msg + "\n\n" + tr("dialog.closeConfirm.message.hint"))) return "save";
    // 第二问：不保存直接关闭？（取消 = 继续编辑）
    if (window.confirm(tr("dialog.closeConfirm.discardAsk"))) {
      return "discard";
    }
    return "cancel";
  }

  /** 保存所有未保存标签。已命名文件写回原路径；未命名标签跳过（需用户手动另存）。
   *  返回是否全部成功。 */
  async function saveAllDirty(dirty: { id: string; path: string | null; content: string }[]): Promise<boolean> {
    let allOk = true;
    for (const t of dirty) {
      if (!t.path) {
        // 未命名标签无法自动保存到原路径，跳过（草稿已由 autosave 兜底）
        continue;
      }
      try {
        const saved = await saveFile(t.path, t.content);
        if (saved) {
          markSaved(saved);
          pushRecent(saved);
        }
      } catch (e) {
        allOk = false;
        alert(tr("dialog.saveFailed") + String(e));
      }
    }
    return allOk;
  }

  // 全局快捷键
  function setupShortcuts() {
    window.addEventListener("keydown", async (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      switch (e.key.toLowerCase()) {
        case "o":
          e.preventDefault();
          await handleOpen();
          break;
        case "s":
          if (e.shiftKey) {
            e.preventDefault();
            await handleSaveAs();
          } else {
            e.preventDefault();
            await handleSave();
          }
          break;
        case "e":
          // Ctrl+E 导出 HTML
          if (e.shiftKey) {
            e.preventDefault();
            await handleExportHtml();
          }
          break;
        case "n":
          e.preventDefault();
          openNew();
          break;
        case "\\":
          // Ctrl+\ 分栏↔编辑；Ctrl+Shift+\ 分栏↔阅读
          if (e.shiftKey) {
            e.preventDefault();
            mode.update((m) => (m === "split" ? "read" : "split"));
          } else {
            e.preventDefault();
            mode.update((m) => (m === "split" ? "edit" : "split"));
          }
          break;
        case "b":
          e.preventDefault();
          toggleSidebar();
          break;
        case "tab":
          // Ctrl+Tab / Ctrl+Shift+Tab 循环标签
          e.preventDefault();
          cycleTab(e.shiftKey ? -1 : 1);
          break;
        case "w":
          // Ctrl+W 关闭当前标签
          e.preventDefault();
          await closeTab(get(activeId));
          break;
      }
    });
  }

  async function handleOpen() {
    try {
      const res = await openFile();
      if (res) {
        openFileInTab(res.path, res.content);
        pushRecent(res.path);
      }
    } catch (e) {
      alert(tr("dialog.openFailed") + String(e));
    }
  }

  async function handleSave() {
    try {
      const saved = await saveFile($doc.path, $doc.content);
      if (saved) {
        markSaved(saved);
        pushRecent(saved);
      }
    } catch (e) {
      alert(tr("dialog.saveFailed") + String(e));
    }
  }

  async function handleSaveAs() {
    try {
      const { saveAsFile } = await import("./lib/tauri/fs.ts");
      const saved = await saveAsFile($doc.content);
      if (saved) {
        markSaved(saved);
        pushRecent(saved);
      }
    } catch (e) {
      alert(tr("dialog.saveAsFailed") + String(e));
    }
  }

  async function handleExportHtml() {
    try {
      const { exportHtml } = await import("./lib/markdown/exportHtml.ts");
      const { basename } = await import("./lib/utils.ts");
      const name = $doc.path ? basename($doc.path) : tr("doc.untitled");
      const saved = await exportHtml($doc.content, name);
      if (saved) {
        // 不加入 .md 最近文件列表（它是 html）
      }
    } catch (e) {
      alert(tr("dialog.exportFailed") + String(e));
    }
  }

  /**
   * 启动文件：若系统以 `vsmreader.exe "C:\path\file.md"` 形式启动本程序
   * （例如用户将 .md 关联到本程序后双击 .md），则自动打开该文件。
   * 内容由 Rust 侧直接读取返回，避免 fs 插件 scope 限制导致静默失败。
   */
  async function openStartupFile() {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ path: string; content: string } | null>(
        "startup_file",
      );
      if (res) {
        openFileInTab(res.path, res.content);
        pushRecent(res.path);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * 崩溃/会话恢复：启动时若存在草稿（上次崩溃/未正常关闭的未命名标签），
   * 静默恢复为脏标签。草稿仅在崩溃/未正常关闭单标签时残留
   * （正常关闭单标签已删草稿），静默恢复符合"防丢失"意图。
   * 恢复后为脏标签（●），用户可保存或关闭。
   */
  async function restoreSession() {
    if (!isTauri || isMobile) return;
    try {
      const drafts = await listDrafts();
      if (drafts.length) restoreDrafts(drafts);
    } catch {
      /* ignore */
    }
  }

  /**
   * 监听 single-instance 事件：当应用已在运行、用户再次双击 .md 时，
   * 已有实例会收到 open-file-request 事件，携带待打开文件的路径。
   * 用 Rust 侧 read_text_file 命令读取内容（绕开 fs 插件 scope 限制）。
   *
   * 移动端无 single-instance 插件，此监听不会收到事件，安全跳过。
   */
  async function setupSingleInstanceListener() {
    if (!isTauri || isMobile) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const { readTextFile } = await import("./lib/tauri/fs.ts");
      await listen<string>("open-file-request", async (ev) => {
        const path = ev.payload;
        if (!path) return;
        try {
          const content = await readTextFile(path);
          openFileInTab(path, content);
          pushRecent(path);
        } catch {
          /* 文件可能已移动/删除 */
        }
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * 移动端 Intent 文件打开：Android 用户在文件管理器/分享菜单选择 .md
   * 用本应用打开时，系统以 VIEW/SEND intent 携带 content:// URI 启动应用。
   * Rust 侧 RunEvent::Opened 把 URL 暂存到 PendingIntents 并 emit "mobile-opened"。
   *
   * 冷启动：前端 onMount 注册监听前 Opened 已触发，emit 的事件会丢失，
   * 故先调用 take_pending_intents 取走暂存 URL（兜底），再注册监听
   * 覆盖已运行实例被 onNewIntent 唤醒的场景。
   *
   * content URI 必须走 fs 插件 readTextFile（已适配 SAF），
   * Rust 侧 read_text_file 用 std::fs 无法读 content URI。
   */
  async function setupMobileIntentListener() {
    if (!isTauri || !isMobile) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const { readTextFile } = await import("./lib/tauri/fs.ts");

      const openUrl = async (rawUrl: string) => {
        const url = rawUrl.trim();
        if (!url) return;
        // 仅处理 markdown 相关来源：content/file URI 或 .md/.markdown/.mdx/.txt
        const lower = url.toLowerCase();
        const isMd =
          lower.startsWith("content://") ||
          lower.startsWith("file://") ||
          /\.(md|markdown|mdx|txt)(\?|$)/.test(lower);
        if (!isMd) return;
        try {
          const content = await readTextFile(url);
          openFileInTab(url, content);
          pushRecent(url);
        } catch (e) {
          console.error("打开 intent 文件失败:", url, e);
        }
      };

      // 兜底：取走冷启动时暂存的 URL（监听注册前已触发的事件）
      try {
        const pending = await invoke<string[]>("take_pending_intents");
        if (pending && pending.length) {
          for (const u of pending) await openUrl(u);
        }
      } catch {
        /* ignore */
      }

      // 监听已运行实例被 onNewIntent 唤醒
      await listen<string[]>("mobile-opened", (ev) => {
        const urls = ev.payload;
        if (!urls || !urls.length) return;
        for (const u of urls) void openUrl(u);
      });
    } catch {
      /* ignore */
    }
  }

  // 大纲跳转
  function jumpToHeading(id: string) {
    editorPaneRef?.scrollToId?.(id);
  }
</script>

<div class="app" data-mode={$mode}>
  <Toolbar onUndo={() => editorPaneRef?.undo?.()} onRedo={() => editorPaneRef?.redo?.()} />
  <TabBar />

  <div class="body">
    {#if $settings.sidebarVisible}
      <aside class="sidebar">
        <Sidebar onJump={jumpToHeading} />
        <button
          class="sidebar-collapse"
          on:click={toggleSidebar}
          title={tr("sidebar.collapse")}
          aria-label={tr("sidebar.collapse")}
        >‹</button>
      </aside>
    {:else}
      <button
        class="sidebar-restore"
        on:click={toggleSidebar}
        title={tr("sidebar.restore")}
        aria-label={tr("sidebar.restore")}
      >›</button>
    {/if}

    <main class="main">
      <EditorPane bind:this={editorPaneRef} />
    </main>
  </div>
  <StatusBar />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .sidebar {
    width: var(--sidebar-w);
    flex-shrink: 0;
    border-right: 1px solid var(--border-soft);
    background: var(--bg);
    overflow: hidden;
    position: relative;
    display: flex;
  }
  /* 折叠按钮：侧栏内右边缘的竖条 */
  .sidebar-collapse {
    width: 20px;
    flex-shrink: 0;
    align-self: stretch;
    background: var(--bg-soft);
    border: none;
    border-left: 1px solid var(--border-soft);
    color: var(--fg-soft);
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .sidebar-collapse:hover {
    background: var(--accent);
    color: #fff;
  }
  /* 恢复按钮：侧栏隐藏时贴左缘的竖条 */
  .sidebar-restore {
    width: 20px;
    flex-shrink: 0;
    background: var(--bg-soft);
    border: none;
    border-right: 1px solid var(--border-soft);
    color: var(--fg-soft);
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8px;
    transition: background 0.12s, color 0.12s;
  }
  .sidebar-restore:hover {
    background: var(--accent);
    color: #fff;
  }
  .main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
</style>
