<script lang="ts">
  import { stats } from "../stores/stats.ts";
  import { doc } from "../stores/doc.ts";
  import { saveError } from "../stores/fileWatch.ts";
  import { t, tr } from "../i18n/index.ts";

  let mode: "default" | "chars" | "words" = "default";

  function fmt(n: number): string {
    return n.toLocaleString();
  }

  function cycleMode() {
    mode = mode === "default" ? "words" : mode === "words" ? "chars" : "default";
  }
</script>

<footer class="statusbar" on:click={cycleMode} title={tr("status.cycleHint")}>
  {#if $saveError}
    <span class="save-error" title={$saveError} on:click|stopPropagation={cycleMode}>⚠</span>
  {/if}
  <span class="item">
    {#if mode === "words"}
      {fmt($stats.words)} {$t("status.words")}
    {:else if mode === "chars"}
      {fmt($stats.chars)} {$t("status.chars")}
    {:else}
      {fmt($stats.words)} {$t("status.words")} · {fmt($stats.lines)} {$t("status.lines")} · {$t("status.about")} {$stats.readingMinutes} {$t("status.minutes")}
    {/if}
  </span>
  <span class="spacer"></span>
  <span class="item path" title={$doc.path ?? tr("doc.unsaved")}>
    {$doc.path ?? tr("doc.unsaved")}
  </span>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: var(--statusbar-h);
    padding: 0 0.6rem;
    background: var(--bg-soft);
    border-top: 1px solid var(--border-soft);
    font-size: 11.5px;
    color: var(--fg-muted);
    flex-shrink: 0;
    user-select: none;
    cursor: pointer;
  }
  .item {
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .path {
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .save-error {
    color: #d33;
    font-size: 13px;
    cursor: help;
    flex-shrink: 0;
  }
</style>
