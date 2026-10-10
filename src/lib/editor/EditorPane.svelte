<script lang="ts">
  import { onMount } from "svelte";
  import Editor from "./Editor.svelte";
  import Preview from "./Preview.svelte";
  import { syncScroll } from "./scrollSync.ts";
  import { mode, saveTabMode, getTabMode } from "../stores/mode.ts";
  import { doc, setContent, activeId } from "../stores/doc.ts";
  import { outline } from "../stores/outline.ts";
  import { scheduleAutoSave } from "../stores/fileWatch.ts";
  import { get } from "svelte/store";
  let editorEl: HTMLElement;
  let previewEl: HTMLElement;
  let previewComponent: Preview;
  let editorComponent: Editor;
  let detachSync: (() => void) | null = null;

  // 记录上次活动标签，用于检测标签切换
  let lastActiveId = $activeId;

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

  /** 撤销（转发给 Editor，供工具栏按钮调用） */
  export function undo() {
    editorComponent?.undo?.();
  }

  /** 重做（转发给 Editor，供工具栏按钮调用） */
  export function redo() {
    editorComponent?.redo?.();
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

  // 切标签：存出旧标签的模式、恢复新标签的模式（使不同文件可处于不同模式）
  $: if ($activeId !== lastActiveId) {
    if (lastActiveId) saveTabMode(lastActiveId, $mode);
    const saved = getTabMode($activeId);
    if (saved && saved !== $mode) mode.set(saved);
    lastActiveId = $activeId;
  }

  onMount(() => {
    requestAnimationFrame(setupSync);
  });
</script>

<div class="pane" data-mode={$mode}>
  <div class="pane-col editor-col" bind:this={editorEl}>
    <Editor value={$doc.content} tabId={$activeId} onInput={handleInput} bind:this={editorComponent} />
  </div>
  <div class="pane-col preview-col" bind:this={previewEl}>
    <Preview source={$doc.content} mode={$mode} tabId={$activeId} bind:this={previewComponent} />
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
