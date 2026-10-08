<script lang="ts">
  import { tabs, activeId, switchTab, closeTab, closeOthers, closeAll, openNew, openFileInTab } from "../stores/doc.ts";
  import { recentFiles } from "../stores/recent.ts";
  import { isTauri, readTextFile } from "../tauri/fs.ts";
  import { t, tr } from "../i18n/index.ts";

  let showRecent = false;
  let ctxMenuId: string | null = null;
  let ctxMenuX = 0;
  let ctxMenuY = 0;

  async function reopen(path: string) {
    showRecent = false;
    if (!isTauri) return;
    try {
      const content = await readTextFile(path);
      openFileInTab(path, content);
    } catch {
      // 文件可能已移动/删除
      alert(tr("dialog.fileMissing"));
    }
  }

  function handleWheel(e: WheelEvent) {
    // 水平滚动：Shift+滚轮 或 触摸板横向
    const el = e.currentTarget as HTMLElement;
    if (e.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  function close(e: MouseEvent, id: string) {
    e.stopPropagation();
    void closeTab(id);
  }

  // 右键菜单
  function onContextMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenuId = id;
    // 定位到鼠标点；右边缘超出时向左偏
    const menuW = 180;
    const vw = window.innerWidth;
    ctxMenuX = e.clientX + menuW > vw ? e.clientX - menuW : e.clientX;
    ctxMenuY = e.clientY;
  }

  function closeOthersClick() {
    const id = ctxMenuId;
    ctxMenuId = null;
    if (id) void closeOthers(id);
  }

  function closeAllClick() {
    ctxMenuId = null;
    void closeAll();
  }

  function closeThisClick() {
    const id = ctxMenuId;
    ctxMenuId = null;
    if (id) void closeTab(id);
  }
</script>

<svelte:window
  on:click={() => { showRecent = false; ctxMenuId = null; }}
  on:contextmenu={(e) => {
    // 点击非标签区时关闭菜单
    if (!(e.target as HTMLElement)?.closest('.tab[data-id]')) ctxMenuId = null;
  }}
/>

<div class="tabs-bar" on:wheel={handleWheel}>
  {#each $tabs as tab (tab.id)}
    <button
      class="tab {tab.id === $activeId ? 'active' : ''}"
      data-id={tab.id}
      on:click={() => switchTab(tab.id)}
      on:contextmenu={(e) => onContextMenu(e, tab.id)}
      title={tab.path ?? tab.name}
    >
      <span class="name">{tab.name}</span>
      <span class="dirty" class:show={tab.dirty}>●</span>
      <span
        class="close"
        on:click={(e) => close(e, tab.id)}
        role="button"
        tabindex="-1"
        title={tr("tab.close")}
      >×</span>
    </button>
  {/each}
  <button class="tab new" on:click={openNew} title={tr("tab.new")}>+</button>

  {#if ctxMenuId !== null}
    <!-- svelte-ignore a11y-no-static-element-interactions, a11y-click-events-have-key-events -->
    <div
      class="ctx-menu"
      style="left:{ctxMenuX}px; top:{ctxMenuY}px"
      on:click|stopPropagation
      on:contextmenu|preventDefault|stopPropagation
      role="menu"
    >
      <button class="ctx-item" on:click={closeThisClick} role="menuitem">
        <span class="ctx-key">×</span>
        <span>{$t("tab.close")}</span>
      </button>
      <button class="ctx-item" on:click={closeOthersClick} role="menuitem">
        <span class="ctx-key"></span>
        <span>{$t("tab.closeOthers")}</span>
      </button>
      <button class="ctx-item" on:click={closeAllClick} role="menuitem">
        <span class="ctx-key"></span>
        <span>{$t("tab.closeAll")}</span>
      </button>
    </div>
  {/if}

  <div class="recent-wrap">
    <button class="tab recent" on:click|stopPropagation={() => (showRecent = !showRecent)} title={tr("tab.recent")}>
      ▾
    </button>
    {#if showRecent}
      <div class="recent-menu" role="menu" on:click|stopPropagation>
        <div class="recent-head">{$t("tab.recent")}</div>
        {#if $recentFiles.length === 0}
          <div class="recent-empty">{$t("toolbar.recent.empty")}</div>
        {:else}
          {#each $recentFiles.slice(0, 12) as f}
            <button class="recent-item" on:click={() => reopen(f.path)} title={f.path}>
              {f.name}
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .tabs-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 34px;
    padding: 0 0.4rem;
    background: var(--bg-soft);
    border-bottom: 1px solid var(--border-soft);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    flex-shrink: 0;
  }
  .tabs-bar::-webkit-scrollbar {
    height: 4px;
  }
  .tabs-bar::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 0.5rem 0 0.7rem;
    border-radius: 5px;
    font-size: 12.5px;
    color: var(--fg-soft);
    background: transparent;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .tab:hover {
    background: var(--bg);
    color: var(--fg);
  }
  .tab.active {
    background: var(--bg);
    color: var(--fg);
    border-color: var(--border-soft);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .name {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dirty {
    color: var(--accent);
    font-size: 10px;
    opacity: 0;
    width: 8px;
  }
  .dirty.show {
    opacity: 1;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    font-size: 14px;
    color: var(--fg-muted);
    opacity: 0;
  }
  .tab:hover .close,
  .tab.active .close {
    opacity: 0.7;
  }
  .close:hover {
    background: var(--bg-soft);
    color: var(--danger, #d33);
    opacity: 1 !important;
  }
  .tab.new,
  .tab.recent {
    width: 26px;
    justify-content: center;
    padding: 0;
    color: var(--fg-muted);
  }
  .recent-wrap {
    position: relative;
    margin-left: auto;
  }
  .recent-menu {
    position: absolute;
    top: 28px;
    right: 0;
    min-width: 220px;
    max-height: 340px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    z-index: 50;
    padding: 4px;
  }
  .recent-head,
  .recent-empty {
    padding: 0.3rem 0.7rem;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .recent-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.7rem;
    font-size: 12.5px;
    color: var(--fg-soft);
    border-radius: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-item:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .ctx-menu {
    position: fixed;
    min-width: 160px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    z-index: 200;
    padding: 4px;
    user-select: none;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0.4rem 0.7rem;
    border-radius: 4px;
    font-size: 12.5px;
    color: var(--fg-soft);
    text-align: left;
  }
  .ctx-item:hover {
    background: var(--accent);
    color: #fff;
  }
  .ctx-key {
    display: inline-block;
    width: 16px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .ctx-item:hover .ctx-key {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
