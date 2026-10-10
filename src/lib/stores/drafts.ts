/**
 * 未命名文档草稿自动保存。
 *
 * 已命名文件由 fileWatch.ts 的 scheduleAutoSave 存到原路径；
 * 未命名标签（path===null）此前无任何保护，崩溃/误关即丢失。
 * 此模块把未命名标签内容定期存到 data_dir/drafts/<tabId>.md，
 * 启动时 listDrafts() 取回恢复。
 *
 * 复用 Rust 侧 write_text_file（自动建父目录）/ read_text_file /
 * list_dir / delete_file 命令，绕开 fs 插件 scope 限制。
 */
import { isTauri } from "../tauri/fs.ts";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: fn } = await import("@tauri-apps/api/core");
  return fn<T>(cmd, args);
}

/** 草稿目录：data_dir/drafts */
async function draftsDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const dir = await invoke<string | null>("app_data_dir");
    if (!dir) return null;
    return dir.replace(/[\\/]+$/, "") + "/drafts";
  } catch {
    return null;
  }
}

export interface Draft {
  id: string;
  content: string;
}

/** 保存（覆盖）某标签的草稿 */
export async function saveDraft(tabId: string, content: string): Promise<void> {
  const dir = await draftsDir();
  if (!dir) return;
  await invoke<string>("write_text_file", {
    path: `${dir}/${tabId}.md`,
    content,
  });
}

/** 删除某标签的草稿（转正为真实文件 / 显式关闭时调用） */
export async function deleteDraft(tabId: string): Promise<void> {
  const dir = await draftsDir();
  if (!dir) return;
  try {
    await invoke<boolean>("delete_file", { path: `${dir}/${tabId}.md` });
  } catch {
    /* 草稿可能不存在，忽略 */
  }
}

/** 列出所有草稿（启动恢复用） */
export async function listDrafts(): Promise<Draft[]> {
  const dir = await draftsDir();
  if (!dir) return [];
  try {
    const entries = await invoke<
      { name: string; is_dir: boolean; size: number }[]
    >("list_dir", { path: dir });
    const out: Draft[] = [];
    for (const e of entries) {
      if (e.is_dir || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      try {
        const content = await invoke<string>("read_text_file", {
          path: `${dir}/${e.name}`,
        });
        out.push({ id, content });
      } catch {
        /* 跳过损坏草稿 */
      }
    }
    return out;
  } catch {
    // drafts 目录不存在等
    return [];
  }
}
