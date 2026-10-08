<script lang="ts">
  import { onMount } from "svelte";
  import Editor from "./Editor.svelte";
  import Preview from "./Preview.svelte";
  import { syncScroll } from "./scrollSync.ts";
  import { mode } from "../stores/mode.ts";
  import { doc, setContent, activeId } from "../stores/doc.ts";
  import { outline } from "../stores/outline.ts";
  import { scheduleAutoSave } from "../stores/fileWatch.ts";
  import { get } from "svelte/store";
  let editorEl: HTMLElement;
  let previewEl: HTMLElement;
  let previewComponent: Preview;
  let editorComponent: Editor;
  let detachSync: (() => void) | null = null;

  function handleInput(v: string) {
    setContent(v);
    scheduleAutoSave(get(activeId));
  }

  /** 滚动到指定锚点：根据当前模式委托给编辑器或预览。
   *  - edit / split：编辑器定位到源码行（split 同时让预览滚动）
   *  - read：预览滚动到锚点元素
   */
  export async function scrollToId(id: string) {
    const m = $mode;
    if (m === "read") {
      await previewComponent?.scrollToId?.(id);
      return;
    }
    // 编辑/分栏模式：从大纲 id 找到对应源码行号，编辑器定位
    const item = $outline.find((it) => it.id === id);
    const line = item?.line ?? 0;
    await editorComponent?.scrollToLine?.(line);
    if (m === "split") {
      // 分栏下也尝试同步预览
      await previewComponent?.scrollToId?.(id);
    }
  }

  // 滚动同步：编辑器滚动 -> 预览滚动（仅分栏模式）
  function setupSync() {
    if (detachSync) {
      detachSync();
      detachSync = null;
    }
    if ($mode !== "split") return;
    const cmScroller = editorEl.querySelector(".cm-scroller") as HTMLElement | null;
    if (cmScroller && previewEl) {
      detachSync = syncScroll(cmScroller, previewEl);
    }
  }

  $: if (editorEl && previewEl) {
    // 模式变化时重置同步
    void $mode;
    requestAnimationFrame(setupSync);
  }

  onMount(() => {
    requestAnimationFrame(setupSync);
  });
</script>

<div class="pane" data-mode={$mode}>
  <div class="pane-col editor-col" bind:this={editorEl}>
    <Editor value={$doc.content} onInput={handleInput} bind:this={editorComponent} />
  </div>
  <div class="pane-col preview-col" bind:this={previewEl}>
    <Preview source={$doc.content} mode={$mode} bind:this={previewComponent} />
  </div>
</div>

<style>
  .pane {
    display: grid;
    height: 100%;
    min-height: 0;
    transition: grid-template-columns 0.18s ease;
  }
  .pane[data-mode="split"] {
    grid-template-columns: 1fr 1fr;
  }
  .pane[data-mode="read"] {
    grid-template-columns: 0 1fr;
  }
  .pane[data-mode="edit"] {
    grid-template-columns: 1fr 0;
  }
  .pane-col {
    min-width: 0;
    overflow: hidden;
  }
  .pane[data-mode="read"] .editor-col {
    visibility: hidden;
    pointer-events: none;
  }
  .pane[data-mode="edit"] .preview-col {
    visibility: hidden;
    pointer-events: none;
  }
</style>
