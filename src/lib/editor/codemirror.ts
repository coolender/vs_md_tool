import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { theme } from "../theme/theme.ts";

/** 亮色 Markdown 语法高亮样式 */
const lightMdStyle = HighlightStyle.define([
  { tag: tags.heading, color: "#1f2328", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#0969da", textDecoration: "underline" },
  { tag: tags.url, color: "#0969da" },
  { tag: tags.quote, color: "#656d76", fontStyle: "italic" },
  { tag: tags.monospace, color: "#1f2328", background: "#f6f8fa" },
  { tag: tags.processingInstruction, color: "#8c959f" },
]);

/** 暗色 Markdown 语法高亮样式 */
const darkMdStyle = HighlightStyle.define([
  { tag: tags.heading, color: "#e6edf3", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
  { tag: tags.url, color: "#58a6ff" },
  { tag: tags.quote, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.monospace, color: "#e6edf3", background: "#161b22" },
  { tag: tags.processingInstruction, color: "#6e7681" },
]);

export function createState(doc: string, onUpdate?: (doc: string) => void) {
  const isDark = theme.resolved === "dark";
  const mdStyle = isDark ? darkMdStyle : lightMdStyle;

  const updateListener = EditorView.updateListener.of((vu) => {
    if (vu.docChanged && onUpdate) {
      onUpdate(vu.state.doc.toString());
    }
  });

  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      markdown({
        base: markdownLanguage,
      }),
      syntaxHighlighting(mdStyle),
      EditorView.lineWrapping,
      updateListener,
    ],
  });
}

/** 创建 EditorView 实例并挂到 parent */
export function createView(parent: HTMLElement, state: EditorState) {
  return new EditorView({ parent, state });
}
