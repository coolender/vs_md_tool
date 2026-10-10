use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// 应用共享状态
pub struct AppState {
    pub portable: bool,
}

/// 待打开文件：single-instance 回调把路径暂存于此，前端聚焦后取走。
#[derive(Default)]
pub struct PendingFile {
    pub path: Mutex<Option<String>>,
}

/// 移动端 Intent 待打开文件：Android 通过 VIEW intent 打开 .md 文件时，
/// tao 在 onCreate/onNewIntent 中提取 content URI 并触发 RunEvent::Opened。
/// 此处暂存 URL 列表，前端 onMount 后调用 take_pending_intents 取走并逐个打开。
///
/// 冷启动时 Opened 事件早于前端监听注册，emit 的事件会丢失，
/// 故采用"暂存 + 取走"模式兜底（与 PendingFile 同思路）。
#[derive(Default)]
pub struct PendingIntents {
    pub urls: Mutex<Vec<String>>,
}

/// 数据目录：便携模式下为 exe 同级 `data/`，否则为系统 app data dir
fn data_dir(app: &AppHandle, portable: bool) -> PathBuf {
    let dir = if portable {
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.join("data")))
            .unwrap_or_else(|| PathBuf::from("data"))
    } else {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
    };
    let _ = fs::create_dir_all(&dir);
    dir
}

fn recent_file_path(app: &AppHandle, portable: bool) -> PathBuf {
    data_dir(app, portable).join("recent.json")
}

/// 是否便携模式（前端可据此决定数据存放位置）
#[tauri::command]
pub fn is_portable_mode(state: State<AppState>) -> bool {
    state.portable
}

/// 返回应用数据目录
#[tauri::command]
pub fn app_data_dir(app: AppHandle, state: State<AppState>) -> Option<String> {
    Some(data_dir(&app, state.portable).to_string_lossy().into_owned())
}

/// 读取最近文件列表 JSON
#[tauri::command]
pub fn read_recent(app: AppHandle, state: State<AppState>) -> Vec<String> {
    let path = recent_file_path(&app, state.portable);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 写入最近文件列表 JSON
#[tauri::command]
pub fn write_recent(app: AppHandle, state: State<AppState>, list: Vec<String>) -> bool {
    let path = recent_file_path(&app, state.portable);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(&list) {
        Ok(s) => fs::write(&path, s).is_ok(),
        Err(_) => false,
    }
}

/// 启动文件：若系统以 `vsmreader.exe "C:\path\file.md"` 形式启动本程序
/// （例如用户将 .md 关联到本程序后双击 .md），则自动打开该文件。
///
/// 在 Rust 侧直接读取文件内容一并返回，避免前端走 fs 插件时受 scope
/// 限制而静默失败（双击桌面任意路径的 .md 时尤其关键）。
///
/// 注意：此命令仅在桌面平台有意义（argv 传文件路径）。
/// 移动端通过 Intent + content URI 打开文件，不走此路径，返回 None。
#[derive(serde::Serialize)]
pub struct StartupFile {
    pub path: String,
    pub content: String,
}

/// 关联的扩展名
const STARTUP_EXTS: [&str; 4] = ["md", "markdown", "mdx", "txt"];

/// 从命令行参数中解析出第一个真实存在且扩展名匹配的文件路径。
/// `args` 应为完整 argv（含 argv[0] 程序路径），内部会 skip(1)。
/// 设为 pub 供 single-instance 回调复用。
///
/// 移动端无 argv 文件参数，直接返回 None。
pub fn parse_md_arg(args: &[String]) -> Option<String> {
    // 移动端没有命令行文件参数语义
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = args;
        return None;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        for arg in args.iter().skip(1) {
            let p = std::path::Path::new(arg);
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if STARTUP_EXTS.contains(&ext.to_lowercase().as_str()) {
                        return Some(arg.clone());
                    }
                }
            }
        }
        None
    }
}

#[tauri::command]
pub fn startup_file() -> Option<StartupFile> {
    // 移动端无 argv 文件参数
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return None;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let args: Vec<String> = std::env::args().collect();
        let path = parse_md_arg(&args)?;
        let content = std::fs::read_to_string(&path).ok()?;
        Some(StartupFile { path, content })
    }
}

/// 取走（并清空）single-instance 回调暂存的待打开文件路径。
/// 前端在窗口重新获得焦点时调用，取到路径则打开该文件。
#[tauri::command]
pub fn take_pending_file(state: State<PendingFile>) -> Option<String> {
    state.path.lock().ok().and_then(|mut g| g.take())
}

/// 取走（并清空）移动端 Intent 暂存的待打开文件 URL 列表。
/// Android：用户在文件管理器/分享菜单选择 .md 用本应用打开时，
/// 系统以 VIEW/SEND intent 携带 content:// URI 启动/唤醒应用，
/// tao 解析后触发 RunEvent::Opened { urls }，lib.rs 把 URL 暂存于此。
/// 前端 onMount 后调用此命令取走 URL，再走 fs 插件读取 content URI。
#[tauri::command]
pub fn take_pending_intents(state: State<PendingIntents>) -> Vec<String> {
    state
        .urls
        .lock()
        .ok()
        .map(|mut g| g.drain(..).collect())
        .unwrap_or_default()
}

/// 读取任意路径的文本文件（绕开 fs 插件 scope 限制）。
/// 用于：打开最近文件、single-instance 二次双击打开、拖入文件等场景。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))
}

/// 写入文本文件到指定路径（绕开 fs 插件 scope 限制）。
/// 用于：保存、另存为。返回写入的路径。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<String, String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&path, &content).map_err(|e| format!("写入失败: {e}"))?;
    Ok(path)
}

/// 取文件修改时间（Unix 毫秒），用于外部变动检测。文件不存在返回 null。
#[tauri::command]
pub fn file_mtime(path: String) -> Option<i64> {
    use std::time::SystemTime;
    fs::metadata(&path)
        .ok()?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

/// 取文件大小（字节），用于状态栏显示。文件不存在返回 null。
#[tauri::command]
pub fn file_size(path: String) -> Option<u64> {
    fs::metadata(&path).ok().map(|m| m.len())
}

/// 列出目录下的文件/子目录（一层），用于文件树浏览。
/// 返回 (name, is_dir, size) 列表，按 目录优先、字母序 排列。
///
/// 注意：移动端（Android/iOS）沙盒限制，只能列出 App 私有目录；
/// 用户共享存储需走 SAF，此命令在移动端仅用于 App 私有目录浏览。
#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = Vec::new();
    let read = fs::read_dir(&path).map_err(|e| format!("读取目录失败: {e}"))?;
    for ent in read.flatten() {
        let name = ent.file_name().to_string_lossy().into_owned();
        // 跳过隐藏文件（以 . 开头）
        if name.starts_with('.') {
            continue;
        }
        let ft = ent.file_type();
        let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
        let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
        entries.push(DirEntry { name, is_dir, size });
    }
    // 目录优先，再按名称排序（不区分大小写）
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// 取指定路径的父目录（用于文件树"返回上级"）。返回规范化的绝对路径。
#[tauri::command]
pub fn parent_dir(path: String) -> Option<String> {
    let p = std::path::Path::new(&path);
    p.parent()
        .map(|x| x.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
}

/// 写入二进制文件（用于粘贴图片保存到本地）。
#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<String, String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&path, &data).map_err(|e| format!("写入失败: {e}"))?;
    Ok(path)
}

/// 删除文件（用于清理草稿）。文件不存在也返回 true（幂等）。
#[tauri::command]
pub fn delete_file(path: String) -> bool {
    match fs::remove_file(&path) {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

/// 取当前文档所在目录（用于图片保存位置、文件树根）。
#[tauri::command]
pub fn dir_of(path: String) -> Option<String> {
    let p = std::path::Path::new(&path);
    p.parent().map(|x| x.to_string_lossy().into_owned())
}
