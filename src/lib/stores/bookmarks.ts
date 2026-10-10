/**
 * 收藏的文档（书签）。
 * 区别于"最近文件"（自动按打开时间排序、有上限），书签是用户主动收藏、可分组、持久化。
 */
import { writable } from "svelte/store";
import { isTauri } from "../tauri/fs.ts";

export interface Bookmark {
  path: string;
  name: string;
  group: string; // 分组名，空字符串=默认组
  addedAt: number; // 时间戳
}

const STORAGE_KEY = "vsmreader.bookmarks";
const MAX = 500;

function loadBrowser(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

async function loadTauri(): Promise<Bookmark[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return loadBrowser();
    const text = await invoke<string>("read_text_file", {
      path: dir.replace(/[\\/]+$/, "") + "/bookmarks.json",
    }).catch(() => null);
    if (!text) return [];
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

async function persist(list: Bookmark[]) {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const dir = await invoke<string | null>("app_data_dir");
      if (!dir) return;
      const path = dir.replace(/[\\/]+$/, "") + "/bookmarks.json";
      await invoke("write_text_file", { path, content: JSON.stringify(list, null, 2) });
    } catch {
      /* ignore */
    }
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
}

export const bookmarks = writable<Bookmark[]>(loadBrowser());

let _loaded = false;
export async function loadBookmarks() {
  if (_loaded) return;
  _loaded = true;
  if (isTauri) {
    const list = await loadTauri();
    bookmarks.set(list);
  }
  bookmarks.subscribe((list) => void persist(list));
}

export function addBookmark(path: string, group = "") {
  const name = path.split(/[\\/]/).pop() ?? path;
  bookmarks.update((list) => {
    if (list.some((b) => samePath(b.path, path))) return list;
    const next = [
      ...list,
      { path, name, group, addedAt: Date.now() },
    ];
    return next.slice(0, MAX);
  });
}

export function removeBookmark(path: string) {
  bookmarks.update((list) => list.filter((b) => !samePath(b.path, path)));
}

export function isBookmarked(path: string): boolean {
  // 简单同步检查（用于 UI 状态）
  let found = false;
  bookmarks.update((list) => {
    found = list.some((b) => samePath(b.path, path));
    return list; // 不修改
  });
  return found;
}

export function moveBookmark(path: string, group: string) {
  bookmarks.update((list) =>
    list.map((b) => (samePath(b.path, path) ? { ...b, group } : b)),
  );
}

function samePath(a: string, b: string): boolean {
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
  // Windows 路径不区分大小写；macOS/Linux 默认区分大小写
  return typeof navigator !== "undefined" && /Win/.test(navigator.platform)
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}
