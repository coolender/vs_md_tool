/**
 * 每标签独立的 CodeMirror EditorState 缓存。
 *
 * 解决"切标签污染撤销栈"问题：Editor.svelte 用单个 EditorView，
 * 切标签时若用 dispatch({changes:...}) 替换全文，替换会被压入
 * 撤销历史，导致切回后 Ctrl+Z 撤销到上一个标签的内容。
 *
 * 改为切标签前把当前 view.state 存出（含 undo 历史/光标/滚动），
 * 切回时用 view.setState(saved) 整体恢复——setState 不压入撤销栈。
 */
import type { EditorState } from "@codemirror/state";
import { writable } from "svelte/store";

const states = new Map<string, EditorState>();
// 每标签顶部可见位置的文档偏移(pos)——滚动位置属于 EditorView 的 DOM 状态，
// 不在 EditorState 内，setState 不会自动保留，故单独缓存。
// 存 pos 而非像素 scrollTop：切回时用 EditorView.scrollIntoView(pos,{y:"start"})
// 恢复，由 CM 测量循环正确处理，不受 setState 后 DOM 布局未稳定的影响。
const scrollPoss = new Map<string, number>();

/** 存出某标签当前的 EditorState（切走前调用） */
export function saveEditorState(tabId: string, state: EditorState): void {
  states.set(tabId, state);
}

/** 存出某标签顶部可见位置的文档偏移（切走前调用） */
export function saveScrollPos(tabId: string, pos: number): void {
  scrollPoss.set(tabId, pos);
}

/** 取走某标签的 EditorState（切入时调用，不从 Map 移除——保留以便再切回） */
export function getEditorState(tabId: string): EditorState | undefined {
  return states.get(tabId);
}

/** 取某标签缓存的顶部可见位置（切入后恢复用），无则 undefined */
export function getScrollPos(tabId: string): number | undefined {
  return scrollPoss.get(tabId);
}

/** 关闭标签时清理其缓存状态与滚动位置 */
export function clearEditorState(tabId: string): void {
  states.delete(tabId);
  scrollPoss.delete(tabId);
}

/** 撤销/重做可用性（供工具栏按钮 disabled 态） */
export const editorHistory = writable<{ canUndo: boolean; canRedo: boolean }>({
  canUndo: false,
  canRedo: false,
});
