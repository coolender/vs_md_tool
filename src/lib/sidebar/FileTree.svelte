<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri, isMobile, readTextFile } from "../tauri/fs.ts";
  import { openFileInTab } from "../stores/doc.ts";
  import { pushRecent } from "../stores/recent.ts";
  import { doc } from "../stores/doc.ts";
  import { t, tr } from "../i18n/index.ts";

  interface Entry {
    name: string;
    isDir: boolean;
    size: number;
  }

  let root = ""; // 当前显示的目录
  let entries: Entry[] = [];
  let loading = false;
  let error = "";

  async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke: fn } = await import("@tauri-apps/api/core");
    return fn<T>(cmd, args);
  }

  function currentDir(): string {
    if (!$doc.path) return "";
    const p = $doc.path;
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i > 0 ? p.slice(0, i) : "";
  }

  async function loadDir(path: string) {
    if (!isTauri || !path) return;
    loading = true;
    error = "";
    try {
      entries = await invoke<Entry[]>("list_dir", { path });
      root = path;
    } catch (e) {
      error = String(e);
      entries = [];
    } finally {
      loading = false;
    }
  }

  async function openEntry(e: Entry) {
    if (e.isDir) {
      await loadDir(root + "\\" + e.name);
    } else {
      const isMd = /\.(md|markdown|mdx|txt)$/i.test(e.name);
      if (!isMd) return;
      const full = root + "\\" + e.name;
      try {
        const content = await readTextFile(full);
        openFileInTab(full, content);
        pushRecent(full);
      } catch {
        alert(tr("filetree.openFailed"));
      }
    }
  }

  async function goUp() {
    if (!root) return;
    try {
      const parent = await invoke<string | null>("parent_dir", { path: root });
      if (parent) await loadDir(parent);
    } catch {
      /* 顶层 */
    }
  }

  function shortName(path: string): string {
    if (!path) return "";
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return i >= 0 ? path.slice(i + 1) : path;
  }

  onMount(() => {
    // 移动端：沙盒限制，无法浏览任意目录；FileTree 仅桌面端启用。
    if (isMobile) return;
    const d = currentDir();
    if (d) void loadDir(d);
  });

  // 文档切换时刷新目录（仅桌面端）
  $: if (isTauri && !isMobile) {
    const d = currentDir();
    if (d && d !== root) void loadDir(d);
  }
</script>

<div class="filetree">
  {#if isMobile}
    <div class="empty">{$t("filetree.mobileHint")}</div>
  {:else}
    <div class="tree-head">
      <button class="up" on:click={goUp} disabled={!root} title={tr("filetree.up")}>↑</button>
      <span class="path" title={root}>{shortName(root) || tr("filetree.browse")}</span>
    </div>
    {#if loading}
      <div class="empty">{$t("filetree.loading")}</div>
    {:else if error}
      <div class="empty">{$t("filetree.readFailed")}</div>
    {:else if entries.length === 0}
      <div class="empty">{$t("filetree.empty")}</div>
    {:else}
      {#each entries as e}
        <button
          class="entry {e.isDir ? 'dir' : 'file'}"
          on:click={() => openEntry(e)}
          title={e.name}
        >
          <span class="icon">{e.isDir ? "📁" : /\.(md|markdown|mdx)$/i.test(e.name) ? "📝" : "📄"}</span>
          <span class="name">{e.name}</span>
        </button>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .filetree {
    height: 100%;
    overflow-y: auto;
    padding: 0.3rem 0;
    font-size: 12.5px;
  }
  .tree-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0.3rem 0.6rem;
    position: sticky;
    top: 0;
    background: var(--bg);
    border-bottom: 1px solid var(--border-soft);
  }
  .up {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    color: var(--fg-muted);
  }
  .up:hover:not(:disabled) {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .up:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .path {
    flex: 1;
    font-size: 11px;
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 0.6rem 0.8rem;
    color: var(--fg-muted);
    font-size: 12px;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 0.25rem 0.7rem;
    color: var(--fg-soft);
    border-radius: 0;
  }
  .entry:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .entry.dir {
    color: var(--fg);
    font-weight: 500;
  }
  .icon {
    width: 16px;
    flex-shrink: 0;
    font-size: 13px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
