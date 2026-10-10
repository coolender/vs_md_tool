import { writable, derived } from "svelte/store";

export type Mode = "split" | "read" | "edit";

/** 默认阅读模式（用户要求：打开时默认阅读而非分栏） */
export const mode = writable<Mode>("read");

/**
 * 每标签独立的模式缓存。
 * 切标签时存出旧标签的模式、恢复新标签的模式，使不同文件可处于不同模式
 * （如标签 A 编辑、标签 B 阅读）。无缓存时回退到默认 "read"。
 */
const tabModes = new Map<string, Mode>();

/** 存出某标签当前模式（切走前调用） */
export function saveTabMode(tabId: string, m: Mode): void {
  tabModes.set(tabId, m);
}

/** 取某标签缓存的模式（切入时调用，无缓存返回 undefined） */
export function getTabMode(tabId: string): Mode | undefined {
  return tabModes.get(tabId);
}

/** 关闭标签时清理其模式缓存 */
export function clearTabMode(tabId: string): void {
  tabModes.delete(tabId);
}

/** 顺序循环切换，用于快捷键 */
export function cycleMode() {
  mode.update((m) => (m === "split" ? "read" : m === "read" ? "edit" : "split"));
}

/** 编辑器是否可见（分栏或全屏编辑时可见） */
export const editorVisible = derived(mode, ($m) => $m !== "read");

/** 预览是否可见（分栏或全屏阅读时可见） */
export const previewVisible = derived(mode, ($m) => $m !== "edit");
