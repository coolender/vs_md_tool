import { writable } from "svelte/store";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "mreader.theme";
const isBrowser = typeof window !== "undefined";

function getSystemPref(): "light" | "dark" {
  return isBrowser && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemPref() : mode;
}

function createThemeStore() {
  let initial: ThemeMode = "system";
  if (isBrowser) {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (saved === "light" || saved === "dark" || saved === "system") {
      initial = saved;
    }
  }

  const { subscribe, set, update } = writable<ThemeMode>(initial);
  let current: ThemeMode = initial;

  // 应用到 <html data-theme="...">
  function apply(mode: ThemeMode) {
    if (!isBrowser) return;
    current = mode;
    const resolved = resolve(mode);
    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem(STORAGE_KEY, mode);
  }

  apply(initial);

  // 监听系统主题变化（仅 system 模式生效）
  if (isBrowser) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", () => {
      if (current === "system") apply("system");
    });
  }

  return {
    subscribe,
    set(mode: ThemeMode) {
      apply(mode);
      set(mode);
    },
    toggle() {
      const next: ThemeMode =
        current === "light" ? "dark" : current === "dark" ? "system" : "light";
      apply(next);
      update(() => next);
    },
    /** 返回当前实际生效的亮/暗（供 Shiki/Mermaid 使用） */
    get resolved(): "light" | "dark" {
      return resolve(current);
    },
    get current(): ThemeMode {
      return current;
    },
  };
}

export const theme = createThemeStore();
