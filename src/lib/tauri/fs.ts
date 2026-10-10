/**
 * 文件系统操作封装。
 * 桌面端优先调用 Rust 侧命令（read_text_file / write_text_file），
 * 这样不受 fs 插件 scope 限制——任意路径都能读写，是保存/打开正常工作的关键。
 * 仅在非 Tauri 环境（浏览器预览）回退到 Web API。
 */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { basename } from "../utils.ts";

const MARKDOWN_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
];

/** 是否运行在 Tauri 桌面环境 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 是否 Android（移动端文件语义不同：沙盒 + SAF） */
export const isAndroid =
  isTauri &&
  typeof navigator !== "undefined" &&
  /Android/i.test(navigator.userAgent);

/** 是否移动端（Android 或 iOS） */
export const isMobile = isTauri && (isAndroid || (/iPad|iPhone|iPod/i.test(navigator.userAgent)));

/** 是否 Windows 桌面端（用于 .md 文件关联等 Windows 专属功能） */
export const isWindows =
  isTauri &&
  typeof navigator !== "undefined" &&
  /Win/.test(navigator.platform);

export interface OpenResult {
  path: string;
  name: string;
  content: string;
}

/** 调用 Rust 侧 invoke（懒加载，避免非 Tauri 环境报错） */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: fn } = await import("@tauri-apps/api/core");
  return fn<T>(cmd, args);
}

/** 打开文件对话框并读取内容 */
export async function openFile(): Promise<OpenResult | null> {
  if (isTauri) {
    // 移动端：dialog.open 在 Android 上返回的是 SAF content URI（如
    // content://com.android.providers.../primary%3ADocuments%2Ffoo.md）。
    // Rust 侧 read_text_file 走 std::fs 无法直接读 content URI，
    // 因此移动端改用 fs 插件 readTextFile（它内部已适配 SAF）。
    const path = await openDialog({
      multiple: false,
      filters: MARKDOWN_FILTERS,
    });
    if (!path || Array.isArray(path)) return null;
    let content: string;
    if (isMobile) {
      const fsMod = await import("@tauri-apps/plugin-fs");
      content = await fsMod.readTextFile(path);
    } else {
      content = await invoke<string>("read_text_file", { path });
    }
    return { path, name: basename(path), content };
  }
  return openFileBrowser();
}

/** 读取指定路径文件内容（用于最近文件、二次双击打开等） */
export async function readTextFile(path: string): Promise<string> {
  if (isTauri) {
    // 移动端：path 可能是 SAF content URI，走 fs 插件（已适配）。
    if (isMobile) {
      const fsMod = await import("@tauri-apps/plugin-fs");
      return fsMod.readTextFile(path);
    }
    return invoke<string>("read_text_file", { path });
  }
  throw new Error("浏览器环境不支持读取本地路径");
}

/** 保存文件。path 为 null 时弹另存对话框。返回保存的路径。 */
export async function saveFile(
  path: string | null,
  content: string,
): Promise<string | null> {
  if (isTauri) {
    let target = path;
    if (!target) {
      target = await saveDialog({ filters: MARKDOWN_FILTERS });
      if (!target) return null;
    }
    if (isMobile) {
      // 移动端 target 可能是 SAF content URI，走 fs 插件。
      const fsMod = await import("@tauri-apps/plugin-fs");
      await fsMod.writeTextFile(target, content);
    } else {
      await invoke<string>("write_text_file", { path: target, content });
    }
    return target;
  }
  downloadBlob(content, path ? basename(path) : "untitled.md");
  return path;
}

/** 另存为：始终弹对话框 */
export async function saveAsFile(content: string): Promise<string | null> {
  if (isTauri) {
    const target = await saveDialog({ filters: MARKDOWN_FILTERS });
    if (!target) return null;
    if (isMobile) {
      const fsMod = await import("@tauri-apps/plugin-fs");
      await fsMod.writeTextFile(target, content);
    } else {
      await invoke<string>("write_text_file", { path: target, content });
    }
    return target;
  }
  downloadBlob(content, "untitled.md");
  return null;
}

/** 浏览器回退实现 */
function openFileBrowser(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdx,.txt,text/markdown";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          path: file.name,
          name: file.name,
          content: String(reader.result ?? ""),
        });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

function downloadBlob(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
