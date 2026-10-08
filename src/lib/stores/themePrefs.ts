/**
 * 自定义 CSS / 主题偏好。
 * 用户可注入自定义 CSS 覆盖阅读区样式（字体、行宽、配色等）。
 * 持久化到 settings.json。
 */
import { writable } from "svelte/store";
import { isTauri } from "../tauri/fs.ts";

export interface ThemePrefs {
  /** 阅读区字体栈（空=用默认） */
  readingFont: string;
  /** 阅读区字号 px */
  readingFontSize: number;
  /** 阅读区行高 */
  readingLineHeight: number;
  /** 阅读区最大宽度 px */
  readingMaxWidth: number;
  /** 自定义 CSS（注入到 .prose 作用域） */
  customCss: string;
}

const DEFAULTS: ThemePrefs = {
  readingFont: "",
  readingFontSize: 16,
  readingLineHeight: 1.7,
  readingMaxWidth: 780,
  customCss: "",
};

const STORAGE_KEY = "vsmreader.themeprefs";

function loadBrowser(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function loadTauri(): Promise<ThemePrefs> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return loadBrowser();
    const text = await invoke<string>("read_text_file", {
      path: dir.replace(/[\\/]+$/, "") + "/themeprefs.json",
    }).catch(() => null);
    if (!text) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(text) };
  } catch {
    return loadBrowser();
  }
}

async function saveTauri(s: ThemePrefs) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return;
    const path = dir.replace(/[\\/]+$/, "") + "/themeprefs.json";
    await invoke("write_text_file", { path, content: JSON.stringify(s, null, 2) });
  } catch {
    /* ignore */
  }
}

function saveBrowser(s: ThemePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const initial = loadBrowser();
export const themePrefs = writable<ThemePrefs>(initial);

let _loaded = false;
export async function loadThemePrefs() {
  if (_loaded) return;
  _loaded = true;
  if (isTauri) {
    const s = await loadTauri();
    themePrefs.set(s);
  }
  themePrefs.subscribe((s) => {
    if (isTauri) void saveTauri(s);
    else saveBrowser(s);
    applyThemePrefs(s);
  });
  applyThemePrefs(initial);
}

export function updateThemePrefs(patch: Partial<ThemePrefs>) {
  themePrefs.update((s) => {
    const next = { ...s, ...patch };
    applyThemePrefs(next);
    return next;
  });
}

/** 把自定义 CSS 注入到 <head> 的 <style id="user-prefs"> */
export function applyThemePrefs(s: ThemePrefs) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("user-prefs") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "user-prefs";
    document.head.appendChild(el);
  }
  const fontCss = s.readingFont
    ? `--font-sans: ${s.readingFont};`
    : "";
  el.textContent = `
:root{
  --reading-font-size: ${s.readingFontSize}px;
  --reading-line-height: ${s.readingLineHeight};
  --reading-max-width: ${s.readingMaxWidth}px;
  ${fontCss}
}
${s.customCss ? `/* 用户自定义 */\n${s.customCss}` : ""}
`;
}
