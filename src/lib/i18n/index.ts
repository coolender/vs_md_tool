/**
 * 轻量国际化：中英文，默认中文。
 *
 * 用法：
 *   import { t } from "../i18n/index.ts";
 *   $t("toolbar.new")   // 自动订阅当前 locale，切换语言时 UI 实时更新
 *
 * 字典按命名空间分组（toolbar / tab / sidebar / settings / dialog …）。
 * 缺失 key 时回退到 zh，再缺失则返回 key 本身（便于发现漏译）。
 */
import { derived } from "svelte/store";
import { settings } from "../stores/settings.ts";

export type Locale = "zh" | "en";

type DictEntry = string | ((...args: unknown[]) => string);
type Dict = Record<string, DictEntry>;

const zh: Dict = {
  // toolbar
  "toolbar.new": "新建",
  "toolbar.open": "打开",
  "toolbar.save": "保存",
  "toolbar.saveAs": "另存",
  "toolbar.export": "导出",
  "toolbar.recent": "最近打开的文件",
  "toolbar.recent.empty": "无",
  "toolbar.toggleSidebar": "切换侧栏",
  "toolbar.mode.split": "分栏",
  "toolbar.mode.read": "阅读",
  "toolbar.mode.edit": "编辑",
  "toolbar.toggleTheme": "切换主题",
  "toolbar.toggleLocale": "切换中/英文",
  "toolbar.settings": "设置",
  "toolbar.md.assoc": "设为 .md 默认程序（注册到系统）",
  "toolbar.md.assoc.registered": "已设为 .md 默认程序（点击取消）",
  "toolbar.md.assoc.register": "注册 .md 关联",
  "toolbar.md.assoc.unregister": "取消 .md 关联",
  "toolbar.dirty": "●",
  "toolbar.undo": "撤销 (Ctrl+Z)",
  "toolbar.redo": "重做 (Ctrl+Y)",

  // tab
  "tab.close": "关闭",
  "tab.closeOthers": "关闭其它",
  "tab.closeAll": "关闭所有",
  "tab.new": "新建标签 (Ctrl+N)",
  "tab.recent": "最近文件",

  // sidebar
  "sidebar.outline": "大纲",
  "sidebar.files": "文件",
  "sidebar.collapse": "隐藏侧栏 (Ctrl+B)",
  "sidebar.restore": "显示侧栏 (Ctrl+B)",

  // settings dialog
  "settings.title": "设置",
  "settings.close": "关闭",
  "settings.autoSave": "自动保存（编辑后延迟写入原文件）",
  "settings.autoSaveDelay": "自动保存延迟",
  "settings.watchFiles": "检测文件外部变动（磁盘文件被改时提示重载）",
  "settings.ms": "毫秒",
  "settings.layout": "阅读区排版",
  "settings.fontStack": "字体栈",
  "settings.fontStack.placeholder": "留空=默认",
  "settings.fontSize": "字号",
  "settings.lineHeight": "行高",
  "settings.maxWidth": "最大宽度",
  "settings.customCss": "自定义 CSS（注入到全局，可覆盖任意样式）",
  "settings.customCss.placeholder": "例如 .prose 加大字号、改字体等",
  "settings.language": "界面语言",
  "settings.language.zh": "中文",
  "settings.language.en": "English",
  "settings.foot": "设置自动保存到应用数据目录。",

  // dialogs
  "dialog.unsavedClose": "有未保存的修改，确定关闭吗？",
  "dialog.unsavedClose.hint": "确定=丢弃修改并关闭 / 取消=继续编辑",
  "dialog.closeConfirm.title": "未保存的修改",
  "dialog.closeConfirm.message": (n: unknown) =>
    `${n} 个标签有未保存的修改。保存并关闭？`,
  "dialog.closeConfirm.message.hint": "确定=保存并关闭 / 取消=继续选择",
  "dialog.closeConfirm.discardAsk": "不保存直接关闭？（修改将丢失，未命名标签可从草稿恢复）",
  "dialog.closeConfirm.save": "保存并关闭",
  "dialog.closeConfirm.dontSave": "不保存",
  "dialog.closeConfirm.cancel": "取消",
  "dialog.closeOthers": (n: unknown) =>
    `有 ${n} 个标签未保存，确定关闭它们吗？`,
  "dialog.closeOthers.hint": "确定=丢弃修改并关闭 / 取消=保留",
  "dialog.closeAll": (n: unknown) =>
    `有 ${n} 个标签未保存，确定全部关闭吗？`,
  "dialog.closeAll.hint": "确定=丢弃修改并关闭 / 取消=保留",
  "dialog.openFailed": "打开失败: ",
  "dialog.saveFailed": "保存失败: ",
  "dialog.saveAsFailed": "另存失败: ",
  "dialog.exportFailed": "导出失败: ",
  "dialog.fileMissing": "无法打开此文件，可能已被移动或删除。",
  "dialog.confirmClose": "确定关闭吗？",
  "dialog.cancel": "取消",
  "dialog.ok": "确定",

  // file association
  "assoc.confirmUnregister": "取消 .md 关联？取消后双击 .md 将不再用 VsMReader 打开。",
  "assoc.registered.title": "已注册 .md 关联。",
  "assoc.registered.body":
    '接下来有两种方式让双击 .md 直接用 VsMReader 打开：\n\n方式一（推荐）：右键任意 .md 文件 → 打开方式 → 选择其他应用 → 选 VsMReader → 勾选"始终使用此应用打开 .md 文件"。\n\n方式二：设置 → 应用 → 默认应用 → 按文件类型设置 → 找到 .md → 选 VsMReader。\n\n（Windows 不允许程序直接抢默认应用，必须用户在系统设置里确认一次。）',
  "assoc.registerFailed": "注册失败，可能需要管理员权限或不支持的系统。",
  "assoc.opFailed": "操作失败: ",

  // bookmarks
  "bookmark.add": "收藏当前文档",
  "bookmark.remove": "取消收藏",
  "bookmark.menu": "收藏夹",
  "bookmark.filter": "筛选...",
  "bookmark.empty": "暂无收藏",
  "bookmark.defaultGroup": "默认",

  // statusbar
  "status.words": "字",
  "status.chars": "字符",
  "status.lines": "行",
  "status.minutes": "分钟",
  "status.about": "约",
  "status.cycleHint": "点击切换显示项",
  "status.saveFailed": "自动保存失败",

  // filetree
  "filetree.mobileHint": "移动端不支持文件树浏览，请用\"打开\"按钮选择文件。",
  "filetree.up": "上级目录",
  "filetree.browse": "文件浏览",
  "filetree.loading": "加载中...",
  "filetree.readFailed": "无法读取目录",
  "filetree.empty": "空目录",
  "filetree.openFailed": "无法打开此文件。",

  // file watch
  "fileWatch.externalChanged": "磁盘上的文件已被外部修改：",
  "fileWatch.dirtyHint": "你有未保存的修改。是否丢弃本地修改并重新加载？",
  "fileWatch.cancelHint": "（取消=保留本地修改）",

  // misc
  "doc.untitled": "未命名.md",
  "doc.emptyHeading": "无标题",
  "doc.emptyBody": "开始书写...",
  "doc.unsaved": "未保存",
};

const en: Dict = {
  // toolbar
  "toolbar.new": "New",
  "toolbar.open": "Open",
  "toolbar.save": "Save",
  "toolbar.saveAs": "Save As",
  "toolbar.export": "Export",
  "toolbar.recent": "Recently opened files",
  "toolbar.recent.empty": "None",
  "toolbar.toggleSidebar": "Toggle sidebar",
  "toolbar.mode.split": "Split",
  "toolbar.mode.read": "Read",
  "toolbar.mode.edit": "Edit",
  "toolbar.toggleTheme": "Toggle theme",
  "toolbar.toggleLocale": "Toggle Chinese/English",
  "toolbar.settings": "Settings",
  "toolbar.md.assoc": "Set as default .md app (register to system)",
  "toolbar.md.assoc.registered": "Set as default .md app (click to unregister)",
  "toolbar.md.assoc.register": "Register .md association",
  "toolbar.md.assoc.unregister": "Unregister .md association",
  "toolbar.dirty": "●",
  "toolbar.undo": "Undo (Ctrl+Z)",
  "toolbar.redo": "Redo (Ctrl+Y)",

  // tab
  "tab.close": "Close",
  "tab.closeOthers": "Close Others",
  "tab.closeAll": "Close All",
  "tab.new": "New tab (Ctrl+N)",
  "tab.recent": "Recent files",

  // sidebar
  "sidebar.outline": "Outline",
  "sidebar.files": "Files",
  "sidebar.collapse": "Hide sidebar (Ctrl+B)",
  "sidebar.restore": "Show sidebar (Ctrl+B)",

  // settings dialog
  "settings.title": "Settings",
  "settings.close": "Close",
  "settings.autoSave": "Auto save (write back to original file after edit, delayed)",
  "settings.autoSaveDelay": "Auto save delay",
  "settings.watchFiles": "Detect external file changes (prompt reload when disk file changes)",
  "settings.ms": "ms",
  "settings.layout": "Reading layout",
  "settings.fontStack": "Font stack",
  "settings.fontStack.placeholder": "empty=default",
  "settings.fontSize": "Font size",
  "settings.lineHeight": "Line height",
  "settings.maxWidth": "Max width",
  "settings.customCss": "Custom CSS (injected globally, overrides any style)",
  "settings.customCss.placeholder": "e.g. enlarge .prose font, change font family",
  "settings.language": "Language",
  "settings.language.zh": "中文",
  "settings.language.en": "English",
  "settings.foot": "Settings are saved to the app data directory.",

  // dialogs
  "dialog.unsavedClose": "There are unsaved changes. Close anyway?",
  "dialog.unsavedClose.hint": "OK = discard changes and close / Cancel = keep editing",
  "dialog.closeConfirm.title": "Unsaved changes",
  "dialog.closeConfirm.message": (n: unknown) =>
    `${n} tab(s) have unsaved changes. Save and close?`,
  "dialog.closeConfirm.message.hint": "OK = save and close / Cancel = choose",
  "dialog.closeConfirm.discardAsk": "Close without saving? (Changes will be lost; untitled tabs can be recovered from drafts)",
  "dialog.closeConfirm.save": "Save and close",
  "dialog.closeConfirm.dontSave": "Don't save",
  "dialog.closeConfirm.cancel": "Cancel",
  "dialog.closeOthers": (n: unknown) =>
    `${n} tab(s) have unsaved changes. Close them?`,
  "dialog.closeOthers.hint": "OK = discard changes and close / Cancel = keep",
  "dialog.closeAll": (n: unknown) =>
    `${n} tab(s) have unsaved changes. Close all?`,
  "dialog.closeAll.hint": "OK = discard changes and close / Cancel = keep",
  "dialog.openFailed": "Open failed: ",
  "dialog.saveFailed": "Save failed: ",
  "dialog.saveAsFailed": "Save as failed: ",
  "dialog.exportFailed": "Export failed: ",
  "dialog.fileMissing": "Cannot open this file. It may have been moved or deleted.",
  "dialog.confirmClose": "Close anyway?",
  "dialog.cancel": "Cancel",
  "dialog.ok": "OK",

  // file association
  "assoc.confirmUnregister":
    "Unregister .md association? Double-clicking .md will no longer open VsMReader.",
  "assoc.registered.title": ".md association registered.",
  "assoc.registered.body":
    'There are two ways to make double-clicking .md open VsMReader directly:\n\nOption 1 (recommended): Right-click any .md file → Open with → Choose another app → pick VsMReader → check "Always use this app to open .md files".\n\nOption 2: Settings → Apps → Default apps → Choose default apps by file type → find .md → pick VsMReader.\n\n(Windows does not allow programs to grab the default app directly; the user must confirm once in system settings.)',
  "assoc.registerFailed":
    "Registration failed. Administrator privileges may be required, or the system is unsupported.",
  "assoc.opFailed": "Operation failed: ",

  // bookmarks
  "bookmark.add": "Bookmark current document",
  "bookmark.remove": "Remove bookmark",
  "bookmark.menu": "Bookmarks",
  "bookmark.filter": "Filter...",
  "bookmark.empty": "No bookmarks",
  "bookmark.defaultGroup": "Default",

  // statusbar
  "status.words": "words",
  "status.chars": "chars",
  "status.lines": "lines",
  "status.minutes": "min",
  "status.about": "about",
  "status.cycleHint": "Click to toggle stats",
  "status.saveFailed": "Auto-save failed",

  // filetree
  "filetree.mobileHint": "File tree browsing is not supported on mobile. Use the \"Open\" button to pick a file.",
  "filetree.up": "Parent directory",
  "filetree.browse": "File browser",
  "filetree.loading": "Loading...",
  "filetree.readFailed": "Cannot read directory",
  "filetree.empty": "Empty directory",
  "filetree.openFailed": "Cannot open this file.",

  // file watch
  "fileWatch.externalChanged": "The file on disk has been modified externally:",
  "fileWatch.dirtyHint": "You have unsaved changes. Discard local changes and reload?",
  "fileWatch.cancelHint": "(Cancel = keep local changes)",

  // misc
  "doc.untitled": "Untitled.md",
  "doc.emptyHeading": "Untitled",
  "doc.emptyBody": "Start writing...",
  "doc.unsaved": "Unsaved",
};

const DICTS: Record<Locale, Dict> = { zh, en };

/** 翻译函数：支持插值参数（用于带数字的提示） */
export function translate(locale: Locale, key: string, ...args: unknown[]): string {
  const dict = DICTS[locale] ?? zh;
  const fallback = DICTS.zh;
  let val = dict[key] ?? fallback[key] ?? key;
  if (typeof val === "function") {
    val = (val as (...a: unknown[]) => string)(...args);
  }
  return val as string;
}

/** 响应式翻译：订阅 settings.locale，切换语言时自动更新 */
export const t = derived(settings, ($s) => {
  const locale = $s.locale;
  return (key: string, ...args: unknown[]) => translate(locale, key, ...args);
});

/** 非响应式翻译（用于无法使用 store 的地方，如 alert/confirm 内） */
export function tr(key: string, ...args: unknown[]): string {
  // 从 settings store 取当前值
  let locale: Locale = "zh";
  // 临时读取当前值（避免循环依赖：不导入 get）
  const unsub = settings.subscribe((s) => {
    locale = s.locale;
  });
  unsub();
  return translate(locale, key, ...args);
}
