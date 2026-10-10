import { writable, derived, get } from "svelte/store";
import { tr } from "../i18n/index.ts";
import { clearEditorState } from "../editor/editorState.ts";
import { clearTabMode } from "./mode.ts";
import { cancelAutoSave, recordSave } from "./fileWatch.ts";
import { deleteDraft, type Draft } from "./drafts.ts";

/**
 * 多标签文档模型。每个标签独立持有 path / content / dirty，
 * 切换标签不丢失内容（解决"不小心把已打开文件弄没了"的问题）。
 *
 * `doc` 仍作为派生视图暴露活动标签的 {path, content, dirty}，
 * 旧代码（Editor/Preview/Toolbar 读 $doc、调用 setContent/markSaved）无需改动。
 */

export interface Tab {
  id: string;
  path: string | null; // 绝对路径；null 表示未保存的新文档
  name: string; // 标签显示名
  content: string;
  dirty: boolean;
}

export interface DocState {
  path: string | null;
  content: string;
  dirty: boolean;
}

let _seq = 0;
function nextId(): string {
  return `tab-${Date.now().toString(36)}-${(++_seq).toString(36)}`;
}

/** 生成当前语言的空白文档内容（语言切换后新建标签会用新语言） */
export function emptyContent(): string {
  return `# ${tr("doc.emptyHeading")}\n\n${tr("doc.emptyBody")}\n`;
}

/** 判断一段内容是否为"空白未命名文档"（用于打开文件时就地替换） */
function isEmptyContent(content: string): boolean {
  // 容忍标题文案随语言变化：只看结构（# 标题 + 空行 + 正文 + 空行）
  return /^# [^\n]*\n\n[^\n]*\n$/.test(content) && !content.includes("\n\n\n");
}

function createUntitled(): Tab {
  return {
    id: nextId(),
    path: null,
    name: tr("doc.untitled"),
    content: emptyContent(),
    dirty: false,
  };
}

// 初始一个空白标签，避免空列表
const initial = createUntitled();
export const tabs = writable<Tab[]>([initial]);
export const activeId = writable<string>(initial.id);

/** 活动标签（派生） */
export const activeTab = derived<[typeof tabs, typeof activeId], Tab>(
  [tabs, activeId],
  ([$tabs, $id]) => $tabs.find((t) => t.id === $id) ?? $tabs[0],
);

/** 兼容旧接口：doc 派生为活动标签视图 */
export const doc = derived<typeof activeTab, DocState>(activeTab, ($t) => ({
  path: $t.path,
  content: $t.content,
  dirty: $t.dirty,
}));

/** 更新活动标签内容（编辑器输入时调用） */
export function setContent(content: string) {
  const id = get(activeId);
  tabs.update((list) =>
    list.map((t) =>
      t.id === id
        ? { ...t, content, dirty: t.content !== content ? true : t.dirty }
        : t,
    ),
  );
}

/** 标记活动标签已保存到 path */
export function markSaved(path: string) {
  const id = get(activeId);
  const name = path.split(/[\\/]/).pop() ?? path;
  const list = get(tabs);
  const tab = list.find((t) => t.id === id);
  // 未命名标签转正为真实文件后，删除其草稿
  if (tab && tab.path === null) {
    void deleteDraft(tab.id);
  }
  tabs.update((ls) =>
    ls.map((t) =>
      t.id === id ? { ...t, path, name, dirty: false } : t,
    ),
  );
  // 记录保存时刻，使自动保存计时以此次手动保存为起点
  recordSave(id);
}

/** 用磁盘上重新读取的内容覆盖指定标签（外部变动重载） */
export function reloadTabContent(id: string, content: string) {
  tabs.update((list) =>
    list.map((t) =>
      t.id === id ? { ...t, content, dirty: false } : t,
    ),
  );
}

/** 取指定标签的快照（不订阅） */
export function getTab(id: string): Tab | undefined {
  return get(tabs).find((t) => t.id === id);
}

/** 新建空白标签并切换为活动 */
export function openNew() {
  const t = createUntitled();
  tabs.update((list) => [...list, t]);
  activeId.set(t.id);
}

/**
 * 打开（或聚焦）一个文件。若该路径已在某标签中打开，则切到该标签而不新建；
 * 否则若当前活动标签是空白的未命名文档，就地替换它（避免一堆"未命名"标签）；
 * 再否则新建标签。
 */
export function openFileInTab(path: string, content: string) {
  const list = get(tabs);
  // 已打开同路径 → 聚焦
  const exist = list.find((t) => t.path && samePath(t.path, path));
  if (exist) {
    activeId.set(exist.id);
    return exist.id;
  }
  const name = path.split(/[\\/]/).pop() ?? path;
  const id = get(activeId);
  const active = list.find((t) => t.id === id);
  // 活动标签是空白未命名 → 就地替换
  if (active && active.path === null && !active.dirty && isEmptyContent(active.content)) {
    // 就地替换前清理旧草稿（若有）
    void deleteDraft(active.id);
    tabs.update((ls) =>
      ls.map((t) =>
        t.id === id ? { ...t, path, name, content, dirty: false } : t,
      ),
    );
    return id;
  }
  // 否则新建标签
  const t: Tab = { id: nextId(), path, name, content, dirty: false };
  tabs.update((ls) => [...ls, t]);
  activeId.set(t.id);
  return t.id;
}

/** 切换到指定标签 */
export function switchTab(id: string) {
  const list = get(tabs);
  if (list.some((t) => t.id === id)) activeId.set(id);
}

/** 关闭指定标签。返回 true 表示已关闭，false 表示用户取消（有未保存修改时）。 */
export async function closeTab(id: string): Promise<boolean> {
  const list = get(tabs);
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return true;
  const tab = list[idx];
  if (tab.dirty) {
    const ok = window.confirm(
      `${tr("dialog.unsavedClose")}\n\n${tr("dialog.unsavedClose.hint")}`,
    );
    if (!ok) return false;
  }
  // 用户确认关闭 → 清理该标签的编辑器状态/模式/自动保存定时器/草稿
  clearEditorState(id);
  clearTabMode(id);
  cancelAutoSave(id);
  void deleteDraft(id);
  const next = list.filter((t) => t.id !== id);
  if (next.length === 0) {
    // 至少保留一个空白标签
    const blank = createUntitled();
    tabs.set([blank]);
    activeId.set(blank.id);
  } else {
    tabs.set(next);
    // 若关的是活动标签，切到相邻
    if (get(activeId) === id) {
      const newIdx = Math.min(idx, next.length - 1);
      activeId.set(next[newIdx].id);
    }
  }
  return true;
}

/** 关闭除指定标签外的所有标签。有未保存修改时统一确认一次。 */
export async function closeOthers(id: string): Promise<void> {
  const list = get(tabs);
  const keep = list.find((t) => t.id === id);
  if (!keep) return;
  const others = list.filter((t) => t.id !== id);
  const dirtyCount = others.filter((t) => t.dirty).length;
  if (dirtyCount > 0) {
    const ok = window.confirm(
      `${tr("dialog.closeOthers", dirtyCount)}\n\n${tr("dialog.closeOthers.hint")}`,
    );
    if (!ok) return;
  }
  // 清理被关标签的状态/模式/定时器/草稿
  for (const t of others) {
    clearEditorState(t.id);
    clearTabMode(t.id);
    cancelAutoSave(t.id);
    void deleteDraft(t.id);
  }
  tabs.set([keep]);
  activeId.set(keep.id);
}

/** 关闭所有标签并新建一个空白标签。有未保存修改时统一确认一次。 */
export async function closeAll(): Promise<void> {
  const list = get(tabs);
  const dirtyCount = list.filter((t) => t.dirty).length;
  if (dirtyCount > 0) {
    const ok = window.confirm(
      `${tr("dialog.closeAll", dirtyCount)}\n\n${tr("dialog.closeAll.hint")}`,
    );
    if (!ok) return;
  }
  // 清理所有标签的状态/模式/定时器/草稿
  for (const t of list) {
    clearEditorState(t.id);
    clearTabMode(t.id);
    cancelAutoSave(t.id);
    void deleteDraft(t.id);
  }
  const blank = createUntitled();
  tabs.set([blank]);
  activeId.set(blank.id);
}

/** 循环切换到下一个标签（Ctrl+Tab） */
export function cycleTab(dir: 1 | -1 = 1) {
  const list = get(tabs);
  if (list.length < 2) return;
  const id = get(activeId);
  const idx = list.findIndex((t) => t.id === id);
  const next = (idx + dir + list.length) % list.length;
  activeId.set(list[next].id);
}

/** 是否存在任意未保存的标签 */
export function anyDirty(): boolean {
  return get(tabs).some((t) => t.dirty);
}

/** 取所有未保存的标签 */
export function dirtyTabs(): Tab[] {
  return get(tabs).filter((t) => t.dirty);
}

/**
 * 启动时从草稿恢复未命名标签（崩溃/未正常关闭兜底）。
 * 复用草稿原 tabId，使后续 saveDraft 覆盖同一文件、deleteDraft 能对应清理。
 * 恢复为脏标签（●），用户可保存或关闭。
 */
export function restoreDrafts(drafts: Draft[]): void {
  if (!drafts.length) return;
  const restored: Tab[] = drafts.map((d) => ({
    id: d.id,
    path: null,
    name: tr("doc.untitled"),
    content: d.content,
    dirty: true,
  }));
  tabs.set(restored);
  activeId.set(restored[0].id);
}

function samePath(a: string, b: string): boolean {
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
  // Windows 路径不区分大小写；macOS/Linux 默认区分大小写（APFS 大小写敏感）
  return /Win/.test(navigator.platform)
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}
