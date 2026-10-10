import { writable } from "svelte/store";

export interface OutlineItem {
  level: number; // 1-6
  text: string; // 纯文本
  id: string; // 锚点 id（markdown-it-anchor 生成）
  line: number; // 源码行号（0-based）
}

export const outline = writable<OutlineItem[]>([]);

/** 当前阅读区视口内最靠上的标题 id（用于侧栏大纲高亮联动）。
 *  null 表示无标题在视口内（如文档顶部）。 */
export const activeHeadingId = writable<string | null>(null);
