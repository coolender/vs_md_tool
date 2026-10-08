import { writable } from "svelte/store";

export interface RecentFile {
  path: string;
  name: string;
}

const STORAGE_KEY = "mreader.recent";
const MAX = 20;

function load(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.slice(0, MAX);
  } catch {
    /* ignore */
  }
  return [];
}

function save(list: RecentFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const recentFiles = writable<RecentFile[]>(load());

export function pushRecent(path: string) {
  const name = path.split(/[\\/]/).pop() ?? path;
  recentFiles.update((list) => {
    const filtered = list.filter((f) => f.path !== path);
    filtered.unshift({ path, name });
    const next = filtered.slice(0, MAX);
    save(next);
    return next;
  });
}
