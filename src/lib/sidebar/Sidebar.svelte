<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import Outline from "./Outline.svelte";
  import { t } from "../i18n/index.ts";

  // props
  export let onJump: (id: string) => void = () => {};

  let tab: "outline" | "files" = "outline";
</script>

<div class="sidebar-inner">
  <div class="sidebar-tabs">
    <button
      class="tab {tab === 'outline' ? 'active' : ''}"
      on:click={() => (tab = "outline")}
    >{$t("sidebar.outline")}</button>
    <button
      class="tab {tab === 'files' ? 'active' : ''}"
      on:click={() => (tab = "files")}
    >{$t("sidebar.files")}</button>
  </div>

  <div class="sidebar-body">
    {#if tab === "outline"}
      <Outline onJump={onJump} />
    {:else}
      <FileTree />
    {/if}
  </div>
</div>

<style>
  .sidebar-inner {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-soft);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    padding: 0.4rem 0;
    font-size: 12px;
    color: var(--fg-muted);
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--fg-soft);
  }
  .tab.active {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .sidebar-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
