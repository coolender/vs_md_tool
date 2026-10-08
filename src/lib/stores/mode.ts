import { writable, derived } from "svelte/store";

export type Mode = "split" | "read" | "edit";

/** 默认阅读模式（用户要求：打开时默认阅读而非分栏） */
export const mode = writable<Mode>("read");

/** 顺序循环切换，用于快捷键 */
export function cycleMode() {
  mode.update((m) => (m === "split" ? "read" : m === "read" ? "edit" : "split"));
}

/** 编辑器是否可见（分栏或全屏编辑时可见） */
export const editorVisible = derived(mode, ($m) => $m !== "read");

/** 预览是否可见（分栏或全屏阅读时可见） */
export const previewVisible = derived(mode, ($m) => $m !== "edit");
