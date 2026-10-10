<script lang="ts">
  import { outline, activeHeadingId } from "../stores/outline.ts";
  import { t } from "../i18n/index.ts";

  // props
  export let onJump: (id: string) => void = () => {};

  // 缩进层级
  const indent = (level: number) => (level - 1) * 12;
</script>

<div class="outline">
  <div class="outline-head">{$t("sidebar.outline")}</div>
  {#if $outline.length === 0}
    <div class="empty">{$t("doc.emptyHeading")}</div>
  {:else}
    <ul>
      {#each $outline as item (item.id)}
        <li
          class="lv-{item.level} {$activeHeadingId === item.id ? 'active' : ''}"
          style="padding-left: {indent(item.level)}px"
        >
          <button class="outline-btn" on:click={() => onJump(item.id)} title={item.text}>
            <span class="dot"></span>
            <span class="text">{item.text}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .outline {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 0.5rem 0;
    font-size: 13px;
  }
  .outline-head {
    padding: 0.4rem 0.9rem;
    color: var(--fg-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .empty {
    padding: 0.6rem 0.9rem;
    color: var(--fg-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    color: var(--fg-soft);
  }
  .outline-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0.3rem 0.9rem;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-align: left;
  }
  .outline-btn:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--border);
    flex-shrink: 0;
  }
  .lv-1 { font-weight: 600; color: var(--fg); }
  .lv-1 .dot { background: var(--accent); }
  /* 当前阅读位置高亮：左侧色条 + 加粗 */
  li.active {
    background: var(--bg-soft);
  }
  li.active .outline-btn {
    color: var(--fg);
    font-weight: 600;
  }
  li.active .dot {
    background: var(--accent);
    width: 5px;
    height: 5px;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
