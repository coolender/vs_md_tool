<script lang="ts">
  import { onMount } from "svelte";
  import { bookmarks, loadBookmarks, addBookmark, removeBookmark } from "../stores/bookmarks.ts";
  import { doc } from "../stores/doc.ts";
  import { isTauri, readTextFile } from "../tauri/fs.ts";
  import { openFileInTab } from "../stores/doc.ts";
  import { pushRecent } from "../stores/recent.ts";
  import { t, tr } from "../i18n/index.ts";

  let showMenu = false;
  let filter = "";

  /** 路径比较：Windows 不区分大小写，macOS/Linux 区分大小写 */
  function sameBookmarkPath(a: string, b: string): boolean {
    const na = a.replace(/\\/g, "/");
    const nb = b.replace(/\\/g, "/");
    return /Win/.test(navigator.platform)
      ? na.toLowerCase() === nb.toLowerCase()
      : na === nb;
  }

  $: currentPath = $doc.path;
  $: isMarked = currentPath
    ? $bookmarks.some((b) => sameBookmarkPath(b.path, currentPath))
    : false;

  $: filtered = $bookmarks.filter(
    (b) =>
      b.name.toLowerCase().includes(filter.toLowerCase()) ||
      b.path.toLowerCase().includes(filter.toLowerCase()),
  );

  // 按 group 分组
  $: groups = (() => {
    const m = new Map<string, typeof filtered>();
    for (const b of filtered) {
      const g = b.group || tr("bookmark.defaultGroup");
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(b);
    }
    return Array.from(m.entries());
  })();

  async function toggleCurrent() {
    if (!currentPath) return;
    if (isMarked) removeBookmark(currentPath);
    else addBookmark(currentPath);
  }

  async function open(path: string) {
    showMenu = false;
    if (!isTauri) return;
    try {
      const content = await readTextFile(path);
      openFileInTab(path, content);
      pushRecent(path);
    } catch {
      alert(tr("dialog.fileMissing"));
    }
  }

  function handleWindowClick(e: MouseEvent) {
    if (!showMenu) return;
    const el = e.target as HTMLElement | null;
    if (el && !el.closest(".bookmark-wrap")) showMenu = false;
  }

  onMount(() => {
    void loadBookmarks();
  });
</script>

<svelte:window on:click={handleWindowClick} />

<div class="bookmark-wrap">
  <button
    class="btn icon"
    on:click|stopPropagation={toggleCurrent}
    disabled={!currentPath}
    title={isMarked ? tr("bookmark.remove") : tr("bookmark.add")}
  >
    {isMarked ? "★" : "☆"}
  </button>
  <button
    class="btn icon"
    on:click|stopPropagation={() => (showMenu = !showMenu)}
    title={tr("bookmark.menu")}
  >
    ☰
  </button>
  {#if showMenu}
    <div class="menu" role="menu" on:click|stopPropagation>
      <input
        class="filter"
        type="text"
        placeholder={tr("bookmark.filter")}
        bind:value={filter}
        on:click|stopPropagation
      />
      {#if groups.length === 0}
        <div class="empty">{$t("bookmark.empty")}</div>
      {:else}
        {#each groups as [group, items]}
          <div class="group-head">{group}</div>
          {#each items as b}
            <button class="item" on:click={() => open(b.path)} title={b.path}>
              <span class="name">{b.name}</span>
              <span class="rm" on:click|stopPropagation={() => removeBookmark(b.path)}>×</span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .bookmark-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .btn.icon {
    width: 30px;
    height: 30px;
    padding: 0;
    justify-content: center;
    font-size: 16px;
    color: var(--fg-soft);
    border-radius: var(--radius-sm);
  }
  .btn.icon:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .btn.icon:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: 34px;
    right: 0;
    width: 280px;
    max-height: 380px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    z-index: 50;
    padding: 4px;
  }
  .filter {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.6rem;
    background: var(--bg-soft);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--fg);
    font-size: 12px;
    margin-bottom: 4px;
  }
  .group-head {
    padding: 0.3rem 0.7rem;
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .empty {
    padding: 0.6rem 0.7rem;
    color: var(--fg-muted);
    font-size: 12px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.6rem;
    font-size: 12.5px;
    color: var(--fg-soft);
    border-radius: 4px;
  }
  .item:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .rm:hover {
    background: var(--bg-soft);
    color: var(--danger);
  }
</style>
