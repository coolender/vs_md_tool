import { writable } from "svelte/store";

export interface OutlineItem {
  level: number; // 1-6
  text: string; // 纯文本
  id: string; // 锚点 id（markdown-it-anchor 生成）
  line: number; // 源码行号（0-based）
}

export const outline = writable<OutlineItem[]>([]);
