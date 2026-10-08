/**
 * Markdown 人性化编辑增强：
 * 1. markdownShortcuts —— Markdown 快捷键（Ctrl+B/I/`/K），选中文本包裹而非替换
 * 2. continueList —— 列表自动续行（回车续 `- ` / `1. ` / `- [ ] `，空项回车取消）
 * 3. closeBrackets —— 括号/引号自动配对（含选中包裹）
 * 4. bracketMatching —— 配对高亮
 * 5. Tab/Shift-Tab 智能缩进
 * 6. Markdown 注释（Ctrl+/）
 * 7. 快速插入：Ctrl+1~6 标题、Ctrl+8 分割线、Ctrl+Shift+T 表格
 * 8. 行操作：Alt+↑/↓ 移动行、Shift+Alt+↑/↓ 复制行
 * 9. 链接拦截：点击预览中外部链接在系统浏览器打开
 *
 * 仅依赖 CodeMirror 核心 + autocomplete，无额外包。
 */
import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection, Transaction } from "@codemirror/state";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { bracketMatching } from "@codemirror/language";
import {
  indentMore,
  indentLess,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  toggleComment,
} from "@codemirror/commands";

/* ============================ 工具函数 ============================ */

/**
 * 对选区应用"包裹"：在每端插入前后缀。
 * 若无选区，插入前后缀并把光标放中间。
 * 幂等检测：若选区已被包裹（前后紧贴相同标记），则去除包裹（toggle）。
 */
function wrapSelection(
  view: EditorView,
  prefix: string,
  suffix: string = prefix,
): boolean {
  const result = view.state.changeByRange((range) => {
    const { from, to } = range;
    if (from === to) {
      // 无选区：插入 prefix+suffix，光标居中
      return {
        changes: [{ from, insert: prefix + suffix }],
        range: EditorSelection.cursor(from + prefix.length),
      };
    }
    const selText = view.state.sliceDoc(from, to);
    // 幂等 toggle：若已被包裹则去除
    const before = view.state.sliceDoc(Math.max(0, from - prefix.length), from);
    const after = view.state.sliceDoc(
      to,
      Math.min(view.state.doc.length, to + suffix.length),
    );
    if (before === prefix && after === suffix) {
      return {
        changes: [
          { from: from - prefix.length, to: from, insert: "" },
          { from: to, to: to + suffix.length, insert: "" },
        ],
        range: EditorSelection.range(from - prefix.length, to - prefix.length),
      };
    }
    return {
      changes: [
        { from, insert: prefix },
        { from: to, insert: suffix },
      ],
      range: EditorSelection.range(from + prefix.length, to + prefix.length),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/** 插入链接：Ctrl+K
 * - 无选区：插入 `[](https://)`，光标停在 `[]` 中间
 * - 有选区：把选区作为链接文字，插入 `[选中](https://)`，光标停在 URL 处
 */
function insertLink(view: EditorView): boolean {
  const urlPlaceholder = "https://";
  const result = view.state.changeByRange((range) => {
    const { from, to } = range;
    if (from === to) {
      const insert = `[](${urlPlaceholder})`;
      return {
        changes: [{ from, insert }],
        range: EditorSelection.cursor(from + 1), // 光标在 [] 中间
      };
    }
    const selText = view.state.sliceDoc(from, to);
    const insert = `[${selText}](${urlPlaceholder})`;
    return {
      changes: [{ from, to, insert }],
      // 光标停在 URL 起始（`[`+sel+`](` 之后）
      range: EditorSelection.cursor(from + 1 + selText.length + 2),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/* ============================ 列表续行 ============================ */

// 匹配列表项前缀：- / * / + / 1. / - [ ] / - [x]
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/;

/** 回车时若当前行是列表项，自动续行；空项回车则取消列表。 */
const continueList = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "\n" && text !== "\r\n") return false;
  if (from !== to) return false; // 有选区时不处理

  const line = view.state.doc.lineAt(from);
  const m = line.text.match(LIST_RE);
  if (!m) return false;

  // 当前光标在列表前缀之后？
  const prefixEnd = m[0].length;
  if (from < line.from + prefixEnd) return false;

  const content = line.text.slice(prefixEnd);
  // 空项回车：取消列表（删掉前缀，留空行）
  if (content.trim() === "") {
    view.dispatch(
      view.state.update({
        changes: { from: line.from, to, insert: "" },
        selection: EditorSelection.cursor(line.from),
        annotations: Transaction.userEvent.of("input"),
      }),
    );
    return true;
  }

  // 续行：复用前缀，任务项的 checkbox 重置为未完成
  let nextPrefix = m[0];
  // 任务列表：[x] → [ ]
  nextPrefix = nextPrefix.replace(/\[[ xX]\]/, "[ ]");
  // 有序列表：数字 +1
  nextPrefix = nextPrefix.replace(/^(\s*)(\d+)\./, (_s, sp, n) => `${sp}${Number(n) + 1}.`);

  view.dispatch(
    view.state.update({
      changes: { from, to, insert: "\n" + nextPrefix },
      selection: EditorSelection.cursor(from + 1 + nextPrefix.length),
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
});

/* ============================ 注释 ============================ */

/**
 * Markdown 注释（HTML 注释形式 <!-- ... -->）：Ctrl+/
 * - 无选区：在当前行行首插入 `<!-- -->`，光标居中
 * - 有选区且未被注释：用 `<!--` `-->` 包裹
 * - 已被注释：去除包裹（toggle）
 */
function toggleMdComment(view: EditorView): boolean {
  const result = view.state.changeByRange((range) => {
    const { from, to } = range;
    if (from === to) {
      const line = view.state.doc.lineAt(from);
      const insert = `<!--  -->`;
      return {
        changes: [{ from: line.from, insert: insert + "\n" }],
        range: EditorSelection.cursor(line.from + 5),
      };
    }
    const selText = view.state.sliceDoc(from, to);
    const before = view.state.sliceDoc(Math.max(0, from - 4), from);
    const after = view.state.sliceDoc(
      to,
      Math.min(view.state.doc.length, to + 3),
    );
    if (before === "<!--" && after === "-->") {
      return {
        changes: [
          { from: from - 4, to: from, insert: "" },
          { from: to, to: to + 3, insert: "" },
        ],
        range: EditorSelection.range(from - 4, to - 4),
      };
    }
    return {
      changes: [
        { from, insert: "<!--" },
        { from: to, insert: "-->" },
      ],
      range: EditorSelection.range(from + 4, to + 4),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/* ============================ 快速插入 ============================ */

/** 在当前行行首设置标题级别：若已有 # 前缀则替换级别，否则插入。
 *  Ctrl+1~6 对应 H1~H6；若该行已是同级别标题则取消（toggle）。
 */
function setHeading(view: EditorView, level: number): boolean {
  const hashes = "#".repeat(level);
  const result = view.state.changeByRange((range) => {
    const line = view.state.doc.lineAt(range.from);
    const m = line.text.match(/^(#{1,6})\s+/);
    if (m) {
      const cur = m[1].length;
      if (cur === level) {
        // 取消标题
        const delTo = line.from + m[0].length;
        return {
          changes: { from: line.from, to: delTo, insert: "" },
          range: EditorSelection.cursor(range.from - m[0].length),
        };
      }
      // 换级别
      const delTo = line.from + m[0].length;
      return {
        changes: { from: line.from, to: delTo, insert: `${hashes} ` },
        range: EditorSelection.cursor(line.from + level + 1),
      };
    }
    // 无标题前缀：在行首插入
    return {
      changes: { from: line.from, insert: `${hashes} ` },
      range: EditorSelection.cursor(range.from + level + 1),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/** 插入分割线 `---`（Ctrl+8）：在空行插入，前后留空行 */
function insertHr(view: EditorView): boolean {
  const result = view.state.changeByRange((range) => {
    const line = view.state.doc.lineAt(range.from);
    const insert = `\n---\n`;
    return {
      changes: { from: range.from, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/** 插入表格模板（Ctrl+Shift+T）：3 列 2 行 */
function insertTable(view: EditorView): boolean {
  const table = `\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n`;
  const result = view.state.changeByRange((range) => {
    return {
      changes: { from: range.from, insert: table },
      range: EditorSelection.cursor(range.from + table.length),
    };
  });
  view.dispatch(
    view.state.update(result, {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("input"),
    }),
  );
  return true;
}

/* ============================ Markdown 快捷键 ============================ */

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

function modKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** 通过 DOM 事件拦截 Ctrl+B/I（CodeMirror keymap 也可，但用捕获层更稳，避免被 defaultKeymap 抢） */
const markdownShortcuts = EditorView.domEventHandlers({
  keydown(e: KeyboardEvent, view: EditorView) {
    if (!modKey(e)) return false;
    const k = e.key.toLowerCase();
    switch (k) {
      case "b":
        e.preventDefault();
        return wrapSelection(view, "**");
      case "i":
        e.preventDefault();
        return wrapSelection(view, "*");
      case "`":
        e.preventDefault();
        return wrapSelection(view, "`");
      case "k":
        e.preventDefault();
        return insertLink(view);
      default:
        return false;
    }
  },
});

/* ============================ 组合导出 ============================ */

/** Markdown 编辑增强全家桶：作为 extension 数组挂到 EditorView */
export const markdownEnhancements = [
  closeBrackets(),
  bracketMatching(),
  continueList,
  markdownShortcuts,
  keymap.of([
    { key: "Tab", run: indentMore },
    { key: "Shift-Tab", run: indentLess },
    // 注释
    { key: "Mod-/", run: toggleMdComment },
    // 标题 H1~H6
    { key: "Mod-1", run: (v) => setHeading(v, 1) },
    { key: "Mod-2", run: (v) => setHeading(v, 2) },
    { key: "Mod-3", run: (v) => setHeading(v, 3) },
    { key: "Mod-4", run: (v) => setHeading(v, 4) },
    { key: "Mod-5", run: (v) => setHeading(v, 5) },
    { key: "Mod-6", run: (v) => setHeading(v, 6) },
    // 分割线
    { key: "Mod-8", run: insertHr },
    // 表格
    { key: "Mod-Shift-t", run: insertTable },
    // 行移动 / 复制（CodeMirror 内置）
    { key: "Alt-ArrowUp", run: moveLineUp },
    { key: "Alt-ArrowDown", run: moveLineDown },
    { key: "Shift-Alt-ArrowUp", run: copyLineUp },
    { key: "Shift-Alt-ArrowDown", run: copyLineDown },
  ]),
];
