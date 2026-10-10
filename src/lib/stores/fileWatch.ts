/**
 * 自动保存 + 文件外部变动检测。
 *
 * - 自动保存：活动标签内容变化后，延迟 N 毫秒保存。
 *   - 已命名文件：写回原路径，成功后清脏标。
 *   - 未命名标签（path===null）：写草稿到 data_dir/drafts/<tabId>.md，
 *     不清脏标（仍未存到真实文件），崩溃后可由 listDrafts 恢复。
 *   保存失败设置 saveError store，状态栏/工具栏展示 ⚠，不再静默。
 * - 变动检测：每 2 秒轮询已命名标签的 mtime，若磁盘版本比内存新且内存未脏，
 *   提示用户重新加载；若内存脏（用户正在改），不自动覆盖，仅提示。
 */
import { writable, get } from "svelte/store";
import { tabs, activeId, getTab, reloadTabContent, markSaved } from "./doc.ts";
import { settings } from "./settings.ts";
import { isTauri, saveFile, readTextFile } from "../tauri/fs.ts";
import { pushRecent } from "./recent.ts";
import { tr } from "../i18n/index.ts";
import { saveDraft } from "./drafts.ts";

interface FileMtime {
  path: string;
  mtime: number;
}

const mtimeCache = new Map<string, number>(); // path -> last known mtime ms
let pollTimer: ReturnType<typeof setInterval> | null = null;
let autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>(); // tabId -> timer

/** 每标签最近一次保存（自动或手动）的时间戳。
 *  自动保存计时锚定到此刻而非最后一次按键——保证持续编辑时
 *  仍每隔 autoSaveDelay 触发一次保存（节流而非防抖）。 */
const lastSaveAt = new Map<string, number>();

/** 刚由本程序自动/手动保存过的路径 -> 保存时刻，用于在短窗口内
 *  抑制文件变动检测，避免把自己写盘的动作误判成"外部修改"。
 *  （否则 pollOnce 会读到刚写入的新 mtime，与缓存不符就弹"外部已变更"。） */
const justSaved = new Map<string, number>();
const JUST_SAVED_WINDOW_MS = 4000;

/** 自动保存错误（非 null 时状态栏/工具栏展示 ⚠） */
export const saveError = writable<string | null>(null);

/** 记录某标签发生了一次保存（自动或手动）。
 *  手动保存路径在 markSaved 后调用此函数，使自动保存计时
 *  以手动保存时刻为起点，避免"刚手动保存又很快触发自动保存"。 */
export function recordSave(tabId: string) {
  lastSaveAt.set(tabId, Date.now());
  // 已保存，取消待触发的自动保存定时器（定时器回调内有 dirty 二次校验，
  // 但显式取消更干净，避免无谓的定时器挂起）
  cancelAutoSave(tabId);
}

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
      // 若是本程序刚保存触发的 mtime 变化，跳过外部变更提示
      const savedAt = justSaved.get(t.path);
      if (savedAt && Date.now() - savedAt < JUST_SAVED_WINDOW_MS) {
        continue;
      }
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
 *
 * 计时锚定到"最近一次保存（自动或手动）"而非最后一次按键，
 * 即节流语义：持续编辑时每隔 autoSaveDelay 触发一次，
 * 而非每次按键都把定时器往后推（那样永不触发）。
 * 若距上次保存已超过 autoSaveDelay，立即触发；否则补足剩余时间。
 */
export function scheduleAutoSave(tabId: string) {
  const s = get(settings);
  if (!s.autoSave) return;
  const tab = getTab(tabId);
  if (!tab || !tab.dirty) return;

  // 清掉旧定时器
  const old = autoSaveTimers.get(tabId);
  if (old) clearTimeout(old);

  // 距上次保存的时间；无记录视为"已超时"（立即保存）
  const last = lastSaveAt.get(tabId) ?? 0;
  const elapsed = Date.now() - last;
  const delay = Math.max(0, s.autoSaveDelay - elapsed);

  const timer = setTimeout(async () => {
    autoSaveTimers.delete(tabId);
    const cur = getTab(tabId);
    if (!cur) return;
    // 保存前再确认仍是脏的（可能用户已手动保存）
    if (!cur.dirty) return;

    // 分支：已命名文件写回原路径；未命名标签写草稿
    if (cur.path) {
      try {
        // 标记"即将由本程序保存"，让文件变动检测在短窗口内不误判为外部修改
        justSaved.set(cur.path, Date.now());
        const saved = await saveFile(cur.path, cur.content);
        if (saved) {
          // 仅当内容未再变化时才清脏标，避免覆盖正在输入的新改动
          const now = getTab(tabId);
          if (now && now.content === cur.content) {
            markSaved(saved);
            pushRecent(saved);
            mtimeCache.set(saved, await getFileMtime(saved) ?? Date.now());
          }
          saveError.set(null);
        }
      } catch (e) {
        saveError.set(tr("status.saveFailed") + String(e));
      }
    } else {
      // 未命名标签：存草稿，不清 dirty（仍未存到真实文件）
      try {
        await saveDraft(tabId, cur.content);
        saveError.set(null);
      } catch (e) {
        saveError.set(tr("status.saveFailed") + String(e));
      }
    }
    // 自动保存完成也记录时刻
    recordSave(tabId);
  }, delay);

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
