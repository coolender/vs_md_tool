/**
 * 自动保存 + 文件外部变动检测。
 *
 * - 自动保存：活动标签内容变化后，延迟 N 毫秒保存到原路径（仅已命名文件）。
 *   保存失败静默（用户可手动保存看错误）。
 * - 变动检测：每 2 秒轮询已命名标签的 mtime，若磁盘版本比内存新且内存未脏，
 *   提示用户重新加载；若内存脏（用户正在改），不自动覆盖，仅提示。
 */
import { get } from "svelte/store";
import { tabs, activeId, getTab, reloadTabContent, markSaved } from "./doc.ts";
import { settings } from "./settings.ts";
import { isTauri, saveFile, readTextFile } from "../tauri/fs.ts";
import { pushRecent } from "./recent.ts";
import { tr } from "../i18n/index.ts";

interface FileMtime {
  path: string;
  mtime: number;
}

const mtimeCache = new Map<string, number>(); // path -> last known mtime ms
let pollTimer: ReturnType<typeof setInterval> | null = null;
let autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>(); // tabId -> timer

/** 启动文件变动轮询（仅 Tauri） */
export function startFileWatcher() {
  if (!isTauri) return;
  if (pollTimer) return;
  pollTimer = setInterval(pollOnce, 2000);
  // 启动时立即记录一次 mtime
  void pollOnce(true);
}

export function stopFileWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function getFileMtime(path: string): Promise<number | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<number | null>("file_mtime", { path });
  } catch {
    return null;
  }
}

async function pollOnce(initial = false) {
  const s = get(settings);
  if (!s.watchFiles) return;
  const $tabs = get(tabs);
  for (const t of $tabs) {
    if (!t.path) continue;
    const mt = await getFileMtime(t.path);
    if (mt == null) continue;
    const prev = mtimeCache.get(t.path);
    if (prev == null) {
      mtimeCache.set(t.path, mt);
      continue;
    }
    if (mt !== prev) {
      mtimeCache.set(t.path, mt);
      if (initial) continue; // 启动时不弹
      handleExternalChange(t.id, t.path, t.dirty);
    }
  }
}

async function handleExternalChange(tabId: string, path: string, dirty: boolean) {
  if (dirty) {
    // 用户有未保存修改：不覆盖，仅提示
    const ok = window.confirm(
      `${tr("fileWatch.externalChanged")}\n${path}\n\n${tr("fileWatch.dirtyHint")}\n${tr("fileWatch.cancelHint")}`,
    );
    if (!ok) return;
  }
  try {
    const content = await readTextFile(path);
    reloadTabContent(tabId, content);
  } catch {
    /* 文件可能已删除 */
  }
}

/**
 * 安排活动标签的自动保存。
 * 由编辑器内容变化时调用。
 */
export function scheduleAutoSave(tabId: string) {
  const s = get(settings);
  if (!s.autoSave) return;
  const tab = getTab(tabId);
  if (!tab || !tab.path || !tab.dirty) return;

  // 清掉旧定时器
  const old = autoSaveTimers.get(tabId);
  if (old) clearTimeout(old);

  const timer = setTimeout(async () => {
    autoSaveTimers.delete(tabId);
    const cur = getTab(tabId);
    if (!cur || !cur.path) return;
    // 保存前再确认仍是脏的（可能用户已手动保存）
    if (!cur.dirty) return;
    try {
      const saved = await saveFile(cur.path, cur.content);
      if (saved) {
        // 仅当内容未再变化时才清脏标，避免覆盖正在输入的新改动
        const now = getTab(tabId);
        if (now && now.content === cur.content) {
          markSaved(saved);
          pushRecent(saved);
          mtimeCache.set(saved, Date.now());
        }
      }
    } catch {
      /* 静默失败，用户可手动保存 */
    }
  }, s.autoSaveDelay);

  autoSaveTimers.set(tabId, timer);
}

/** 清除某标签的自动保存定时器（关闭标签时） */
export function cancelAutoSave(tabId: string) {
  const t = autoSaveTimers.get(tabId);
  if (t) {
    clearTimeout(t);
    autoSaveTimers.delete(tabId);
  }
}
