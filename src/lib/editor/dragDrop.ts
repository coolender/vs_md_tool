/**
 * 人性化编辑增强（第二批）：
 * 4. Tab/Shift-Tab 智能缩进 —— 已在 markdownEnhance.ts 的 markdownEnhancements 中提供
 * 5. 拖入图片/文件 —— 拖图自动插入 `![](path)` 或 `[](path)`
 *    粘贴 URL 成链 —— 选中文字时粘贴 http(s) 链接，自动变成 `[选中](url)`
 * 9. 粘贴图片 —— 剪贴板是图片时，保存到文档同目录/images，插入 `![](相对路径)`
 *
 * 挂到 EditorView 作为 extension。
 */
import { EditorView } from "@codemirror/view";
import { EditorSelection, Transaction } from "@codemirror/state";

/** 判断是否为图片扩展名 */
function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name);
}

/** 把文件路径转为适合 markdown 的引用（Windows 反斜杠 → 正斜杠） */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 拖拽插入：文件 → 图片 `![](path)` / 普通 `[](path)` */
const dropHandler = EditorView.domEventHandlers({
  drop(e: DragEvent, view: EditorView) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return false;
    e.preventDefault();

    const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    const inserts: string[] = [];
    for (const f of Array.from(files)) {
      const path = normalizePath(f.name); // 浏览器/tauri drop 时 name 可能含路径
      // Tauri 环境下 dataTransfer 可能带文件路径（通过 text/plain），这里用 name 兜底
      const isImg = isImageName(f.name);
      const alt = f.name.replace(/\.[^.]+$/, "");
      inserts.push(isImg ? `![${alt}](${path})` : `[${f.name}](${path})`);
    }
    const text = inserts.join("\n\n");
    view.dispatch(view.state.update({
      changes: { from: dropPos, insert: text },
      selection: EditorSelection.cursor(dropPos + text.length),
      annotations: Transaction.userEvent.of("input.drop"),
    }));
    view.focus();
    return true;
  },
  dragover(e: DragEvent, _view: EditorView) {
    // 允许 drop
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    return false;
  },
});

/** 取当前文档所在目录（用于图片保存位置）。无路径时返回 null。 */
async function getDocDir(): Promise<string | null> {
  try {
    const { doc } = await import("../stores/doc.ts");
    const { get } = await import("svelte/store");
    const d = get(doc);
    if (!d.path) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("dir_of", { path: d.path });
  } catch {
    return null;
  }
}

/** 把剪贴板里的图片保存为本地文件，返回插入的 markdown 文本（失败返回 null）。 */
async function saveClipboardImage(blob: Blob): Promise<string | null> {
  try {
    const isTauriEnv =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isTauriEnv) return null;

    const isMobileEnv =
      typeof navigator !== "undefined" && /Android|iPad|iPhone|iPod/i.test(navigator.userAgent);

    // 移动端：文档路径可能是 SAF content URI，无法用 write_binary_file 写到"文档旁边"。
    // 改为存到 App 私有目录的 images/ 下，引用用绝对私有路径（预览时由 asset 协议加载）。
    let saveDir: string | null = null;
    let ref: string;

    if (!isMobileEnv) {
      // 桌面端：优先存到文档同目录
      saveDir = await getDocDir();
    }
    if (!saveDir) {
      // 回退（含移动端）：app data dir 的 images 子目录
      const { invoke } = await import("@tauri-apps/api/core");
      const base = await invoke<string | null>("app_data_dir");
      if (!base) return null;
      saveDir = base.replace(/[\\/]+$/, "") + "/images";
    }

    // 文件名：pasted-YYYYMMDD-HHmmss.<ext>
    const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `pasted-${stamp}.${ext}`;
    const fullPath = saveDir.replace(/[\\/]+$/, "") + "/" + fileName;

    const buf = new Uint8Array(await blob.arrayBuffer());
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_binary_file", { path: fullPath, data: Array.from(buf) });

    // markdown 引用路径
    if (!isMobileEnv) {
      // 桌面端：优先相对路径（与文档同目录时）
      const { doc } = await import("../stores/doc.ts");
      const { get } = await import("svelte/store");
      const d = get(doc);
      if (d.path) {
        const docDir = await invoke<string | null>("dir_of", { path: d.path });
        if (docDir && fullPath.startsWith(docDir)) {
          ref = fullPath.slice(docDir.length).replace(/^[\\/]+/, "");
        } else {
          ref = fullPath;
        }
      } else {
        ref = fullPath;
      }
    } else {
      // 移动端：用绝对私有路径，预览时由 asset 协议加载
      ref = fullPath;
    }
    ref = normalizePath(ref);
    return `![${fileName.replace(/\.[^.]+$/, "")}](${ref})`;
  } catch (e) {
    console.error("[paste-image] 保存失败:", e);
    return null;
  }
}

/** 粘贴增强：
 *  - 剪贴板是图片 → 保存为本地文件并插入 `![](path)`（#9）
 *  - 选中文本 + 粘贴 URL → `[选中](url)`
 *
 * 注意：CodeMirror 的 paste handler 期望同步返回 boolean|void，
 * 但图片保存是异步的。这里同步 preventDefault 后异步插入，
 * 返回 true 以阻止默认粘贴。
 */
const pasteHandler = EditorView.domEventHandlers({
  paste(e: ClipboardEvent, view: EditorView) {
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) {
            e.preventDefault();
            void insertClipboardImage(blob, view);
            return true;
          }
        }
      }
    }

    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return false;
    // 仅当是 URL 时增强
    if (!/^https?:\/\/\S+$/i.test(text.trim())) return false;

    const { from, to } = view.state.selection.main;
    if (from === to) return false; // 无选区，走默认粘贴

    const sel = view.state.sliceDoc(from, to);
    // 避免对已经是链接的选中重复包裹
    if (/^\[.*\]\(.*\)$/.test(sel)) return false;

    e.preventDefault();
    const insert = `[${sel}](${text.trim()})`;
    view.dispatch(view.state.update({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + insert.length),
      annotations: Transaction.userEvent.of("input.paste"),
    }));
    return true;
  },
});

/** 异步：保存剪贴板图片并插入到编辑器 */
async function insertClipboardImage(blob: Blob, view: EditorView) {
  const text = await saveClipboardImage(blob);
  if (!text) {
    alert("粘贴图片失败：无法保存到本地。");
    return;
  }
  const pos = view.state.selection.main.head;
  view.dispatch(view.state.update({
    changes: { from: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
    annotations: Transaction.userEvent.of("input.paste"),
  }));
  view.focus();
}

/** 第 4-5-9 批增强：拖拽 + 粘贴（含图片） */
export const dragDropEnhancements = [dropHandler, pasteHandler];
