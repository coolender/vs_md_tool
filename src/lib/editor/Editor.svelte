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
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { searchKeymap } from "@codemirror/search";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { theme } from "../theme/theme.ts";
  import { markdownEnhancements } from "./markdownEnhance.ts";
  import { dragDropEnhancements } from "./dragDrop.ts";

  // props
  export let value: string;
  export let onInput: (v: string) => void = () => {};

  let host: HTMLElement;
  let view: EditorView | null = null;
  let lastExternal = value;

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
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(mdStyle),
      EditorView.updateListener.of((vu) => {
        if (vu.docChanged) {
          lastExternal = vu.state.doc.toString();
          onInput(lastExternal);
        }
      }),
    ];
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: value, extensions: buildExtensions() }),
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // 外部 value 变化时同步到编辑器（避免覆盖用户正在输入的内容）
  $: if (view && value !== lastExternal) {
    lastExternal = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
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
