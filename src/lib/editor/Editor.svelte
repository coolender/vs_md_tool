<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
  } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    undo as undoCmd,
    redo as redoCmd,
    undoDepth,
    redoDepth,
    deleteLine,
  } from "@codemirror/commands";
  import { searchKeymap } from "@codemirror/search";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { theme } from "../theme/theme.ts";
  import { markdownEnhancements } from "./markdownEnhance.ts";
  import { dragDropEnhancements } from "./dragDrop.ts";
  import { mode } from "../stores/mode.ts";
  import { outline, activeHeadingId, type OutlineItem } from "./../stores/outline.ts";
  import {
    saveEditorState,
    getEditorState,
    saveScrollPos,
    getScrollPos,
    editorHistory,
  } from "./editorState.ts";

  // props
  export let value: string;
  export let tabId: string;
  export let onInput: (v: string) => void = () => {};

  let host: HTMLElement;
  let view: EditorView | null = null;
  let lastExternal = value;
  let lastTabId = tabId;

  // 当前模式与大纲（响应式本地副本，供 updateListener 闭包读取）
  let curMode = $mode;
  $: curMode = $mode;
  let outlineItems: OutlineItem[] = [];
  $: outlineItems = $outline;

  /** 滚动到指定源码行（用于大纲跳转在编辑模式下定位） */
  export async function scrollToLine(line: number) {
    if (!view) return;
    const lineCount = view.state.doc.lines;
    const targetLine = Math.max(1, Math.min(line + 1, lineCount));
    const pos = view.state.doc.line(targetLine).from;
    view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 12 }),
      selection: { anchor: pos },
    });
    view.focus();
  }

  /**
   * 根据编辑器视口顶部可见行，反查最近一个标题，更新大纲高亮。
   * 编辑/分栏模式下编辑器是主滚动源，用源码行号定位标题比 DOM 更直接。
   */
  function updateActiveHeadingFromEditor(v: EditorView) {
    if (outlineItems.length === 0) {
      activeHeadingId.set(null);
      return;
    }
    // 取视口顶部偏下一点的行号（视觉上"当前"的标题）
    const topLine = v.state.doc.lineAt(
      v.lineBlockAtHeight(v.scrollDOM.scrollTop + 40).from,
    ).number;
    // 0-based 行号 → 找最后一个 line <= topLine 的标题
    let found: OutlineItem | null = null;
    for (const it of outlineItems) {
      if (it.line + 1 <= topLine) found = it;
      else break;
    }
    activeHeadingId.set(found ? found.id : null);
  }

  /** 撤销（供工具栏按钮调用） */
  export function undo() {
    if (view) undoCmd(view);
  }

  /** 重做（供工具栏按钮调用） */
  export function redo() {
    if (view) redoCmd(view);
  }

  /** 取编辑器视口顶部可见的文档偏移（pos）。
   *  用 lineBlockAtHeight 从 scrollDOM 顶部反查行，再取该行起点 pos。
   *  scrollTop 受 setState 后 DOM 布局未稳定影响，pos 语义稳定可靠。 */
  function topVisiblePos(): number {
    if (!view) return 0;
    try {
      const block = view.lineBlockAtHeight(
        view.scrollDOM.scrollTop + 4,
      );
      return block.from;
    } catch {
      return 0;
    }
  }

  // 亮/暗 Markdown 语法高亮样式
  const lightStyle = HighlightStyle.define([
    { tag: tags.heading, color: "#1f2328", fontWeight: "600" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.link, color: "#0969da", textDecoration: "underline" },
    { tag: tags.url, color: "#0969da" },
    { tag: tags.quote, color: "#656d76", fontStyle: "italic" },
    { tag: tags.monospace, color: "#1f2328", background: "#f6f8fa" },
    { tag: tags.processingInstruction, color: "#8c959f" },
  ]);
  const darkStyle = HighlightStyle.define([
    { tag: tags.heading, color: "#e6edf3", fontWeight: "600" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
    { tag: tags.url, color: "#58a6ff" },
    { tag: tags.quote, color: "#8b949e", fontStyle: "italic" },
    { tag: tags.monospace, color: "#e6edf3", background: "#161b22" },
    { tag: tags.processingInstruction, color: "#6e7681" },
  ]);

  function buildExtensions() {
    const mdStyle = theme.resolved === "dark" ? darkStyle : lightStyle;
    return [
      EditorView.lineWrapping,
      // 拼写检查：启用浏览器原生拼写检查（英文等拉丁语系）。
      // 中文等 CJK 语种浏览器不检查，无副作用。
      EditorView.contentAttributes.of({
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "on",
      }),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      ...markdownEnhancements,
      ...dragDropEnhancements,
      keymap.of([
        // Ctrl+D 删除当前行（必须置于 defaultKeymap 之前，
        // 覆盖后者将 Ctrl-D 绑到"向下复制行"的默认行为）
        { key: "Ctrl-d", run: deleteLine },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(mdStyle),
      EditorView.updateListener.of((vu) => {
        if (vu.docChanged) {
          lastExternal = vu.state.doc.toString();
          onInput(lastExternal);
        }
        // 滚动联动大纲高亮（仅编辑/分栏模式：编辑器是主视图时）
        if (vu.viewportChanged && (curMode === "edit" || curMode === "split")) {
          updateActiveHeadingFromEditor(vu.view);
        }
        // 更新撤销/重做可用性（仅在变化时 set，避免频繁重渲染）
        const canUndo = undoDepth(vu.state) > 0;
        const canRedo = redoDepth(vu.state) > 0;
        if (
          canUndo !== lastHist.canUndo ||
          canRedo !== lastHist.canRedo
        ) {
          lastHist = { canUndo, canRedo };
          editorHistory.set(lastHist);
        }
      }),
    ];
  }

  let lastHist = { canUndo: false, canRedo: false };

  onMount(() => {
    // 启动时若该标签有缓存状态（如从草稿恢复后切回），优先恢复
    const saved = getEditorState(tabId);
    const initial =
      saved && saved.doc.toString() === value
        ? saved
        : EditorState.create({ doc: value, extensions: buildExtensions() });
    view = new EditorView({ parent: host, state: initial });
    lastExternal = view.state.doc.toString();
    lastTabId = tabId;
    // 恢复缓存的滚动位置（deferred 后 DOM 已布局）
    const savedPos = getScrollPos(tabId);
    if (savedPos != null) {
      requestAnimationFrame(() => {
        if (view) {
          view.dispatch({
            effects: EditorView.scrollIntoView(savedPos, { y: "start", yMargin: 0 }),
          });
        }
      });
    }
    // 同步初始撤销/重做可用性
    const canUndo = undoDepth(view.state) > 0;
    const canRedo = redoDepth(view.state) > 0;
    if (canUndo !== lastHist.canUndo || canRedo !== lastHist.canRedo) {
      lastHist = { canUndo, canRedo };
      editorHistory.set(lastHist);
    }
    // 编辑模式下初始即定位大纲高亮
    if (curMode === "edit" || curMode === "split") {
      updateActiveHeadingFromEditor(view);
    }
  });

  onDestroy(() => {
    // 卸载前存出当前标签状态与滚动位置，便于组件重建时恢复
    if (view) {
      saveEditorState(lastTabId, view.state);
      saveScrollPos(lastTabId, topVisiblePos());
    }
    view?.destroy();
    view = null;
  });

  // 切标签：存出旧标签状态与滚动位置，恢复/重建新标签状态。
  // 必须置于内容同步块之前，保证切标签优先于内容同步。
  $: if (view && tabId !== lastTabId) {
    saveEditorState(lastTabId, view.state);
    saveScrollPos(lastTabId, topVisiblePos());
    lastTabId = tabId;
    const saved = getEditorState(tabId);
    if (saved && saved.doc.toString() === value) {
      // 恢复缓存状态（含 undo 历史/光标/滚动），setState 不压入撤销栈
      view.setState(saved);
    } else {
      // 内容与缓存不一致（如磁盘重载）→ 重建
      view.setState(
        EditorState.create({ doc: value, extensions: buildExtensions() }),
      );
    }
    // 滚动位置不在 EditorState 内，setState 不保留——用 scrollIntoView 恢复。
    // setState 创建新 ViewState 会把 scrollTop 重置为 0，且 CM 测量是异步的，
    // 同帧 dispatch 的 scrollIntoView 会在测量完成前执行被冲掉。
    // 用 setTimeout(0) 延后到 CM 测量循环完成后执行，避开布局竞争。
    const savedPos = getScrollPos(tabId);
    if (savedPos != null) {
      setTimeout(() => {
        if (!view) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(savedPos, { y: "start", yMargin: 0 }),
        });
      }, 0);
    }
    lastExternal = value;
    // 同步当前标签撤销/重做可用性
    const canUndo = undoDepth(view.state) > 0;
    const canRedo = redoDepth(view.state) > 0;
    if (canUndo !== lastHist.canUndo || canRedo !== lastHist.canRedo) {
      lastHist = { canUndo, canRedo };
      editorHistory.set(lastHist);
    }
    // 切标签后按当前滚动位置定位大纲高亮
    if (curMode === "edit" || curMode === "split") {
      updateActiveHeadingFromEditor(view);
    }
  }

  // 模式切换到编辑/分栏时，立即按编辑器滚动位置定位大纲高亮
  $: if (view && (curMode === "edit" || curMode === "split")) {
    void $mode;
    updateActiveHeadingFromEditor(view);
  }

  // 外部 value 变化时同步到编辑器（避免覆盖用户正在输入的内容）
  // 仅同标签内的外部变动（如打开文件就地替换、磁盘重载）触发；切标签由上面的块处理。
  // 用 setState 重建而非 dispatch 全文替换——dispatch 会把替换压入撤销栈，
  // 导致打开文件后 Ctrl+Z 能撤销回空白模板（"回退到空白文档"bug）。
  // 外部整体内容变化语义上是"新文档"，旧撤销历史无意义，重建清空。
  $: if (view && tabId === lastTabId && value !== lastExternal) {
    lastExternal = value;
    view.setState(
      EditorState.create({ doc: value, extensions: buildExtensions() }),
    );
    // 重建后同步撤销/重做可用性
    const canUndo = undoDepth(view.state) > 0;
    const canRedo = redoDepth(view.state) > 0;
    if (canUndo !== lastHist.canUndo || canRedo !== lastHist.canRedo) {
      lastHist = { canUndo, canRedo };
      editorHistory.set(lastHist);
    }
  }
</script>

<div class="editor-wrap" bind:this={host}></div>

<style>
  .editor-wrap {
    height: 100%;
    overflow: hidden;
  }
  .editor-wrap :global(.cm-editor) {
    height: 100%;
  }
</style>
