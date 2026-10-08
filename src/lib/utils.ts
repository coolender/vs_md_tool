/** 简单防抖 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** 从文件路径提取文件名 */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 生成简易 id（用于大纲锚点兜底） */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-龥\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
