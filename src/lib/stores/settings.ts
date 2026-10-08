/**
 * 设置存储：跨会话持久化的用户偏好。
 * Tauri 环境走 Rust 侧 app_data_dir/settings.json；
 * 浏览器环境回退 localStorage。
 */
import { writable } from "svelte/store";
import { isTauri } from "../tauri/fs.ts";

export interface Settings {
  /** 自动保存（编辑后延迟保存到原路径，仅对已命名文件生效） */
  autoSave: boolean;
  /** 自动保存延迟（毫秒） */
  autoSaveDelay: number;
  /** 文件外部变动检测：磁盘文件被改时提示重新加载 */
  watchFiles: boolean;
  /** 左侧栏是否显示（跨会话记忆） */
  sidebarVisible: boolean;
  /** 界面语言：'zh' | 'en'，默认 'zh' */
  locale: "zh" | "en";
}

const DEFAULTS: Settings = {
  autoSave: true,
  autoSaveDelay: 1500,
  watchFiles: true,
  sidebarVisible: true,
  locale: "zh",
};

const STORAGE_KEY = "vsmreader.settings";

function loadBrowser(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function loadTauri(): Promise<Settings> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return loadBrowser();
    const text = await invoke<string>("read_text_file", {
      path: dir.replace(/[\\/]+$/, "") + "/settings.json",
    }).catch(() => null);
    if (!text) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(text) };
  } catch {
    return loadBrowser();
  }
}

async function saveTauri(s: Settings) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return;
    const path = dir.replace(/[\\/]+$/, "") + "/settings.json";
    await invoke("write_text_file", { path, content: JSON.stringify(s, null, 2) });
  } catch {
    /* ignore */
  }
}

function saveBrowser(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// 初始值先用浏览器快照，Tauri 环境异步覆盖
const initial = loadBrowser();
export const settings = writable<Settings>(initial);

let _loaded = false;
export async function loadSettings() {
  if (_loaded) return;
  _loaded = true;
  if (isTauri) {
    const s = await loadTauri();
    settings.set(s);
  }
  settings.subscribe((s) => {
    if (isTauri) void saveTauri(s);
    else saveBrowser(s);
  });
}

export function updateSettings(patch: Partial<Settings>) {
  settings.update((s) => ({ ...s, ...patch }));
}
