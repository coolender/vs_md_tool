mod assoc;
mod commands;

// Emitter 提供 emit() 方法，桌面（single-instance 回调）与移动端
// （RunEvent::Opened 转发 intent URL）都需要。所有平台统一引入。
use tauri::Emitter;
// Manager trait 提供 manage() / get_webview_window() / state() 等方法，所有平台都需要。
use tauri::Manager;

/// 检测是否为便携模式：exe 同级目录存在 `portable.txt` 时，
/// 将应用数据（最近文件、设置）存放在 exe 所在目录而非 %APPDATA%。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn is_portable(app: &tauri::App) -> bool {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("portable.txt").exists();
        }
    }
    let _ = app;
    false
}

/// 移动端没有"便携模式"概念，数据始终存于 App 私有目录。
#[cfg(any(target_os = "android", target_os = "ios"))]
fn is_portable(_app: &tauri::App) -> bool {
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // 桌面专属插件：仅非移动平台注册。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                // 已有实例运行时，双击 .md 会把路径作为 argv 传到这里。
                // 解析出 .md 路径后，把窗口拉到前台，并通过事件通知前端打开该文件。
                if let Some(path) = commands::parse_md_arg(&args) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                        let _ = w.emit("open-file-request", path.clone());
                    }
                }
            }));
    }

    builder
        .setup(|app| {
            let portable = is_portable(app);
            app.manage(commands::AppState { portable });
            app.manage(commands::PendingFile::default());
            app.manage(commands::PendingIntents::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::is_portable_mode,
            commands::app_data_dir,
            commands::read_recent,
            commands::write_recent,
            commands::startup_file,
            commands::take_pending_file,
            commands::take_pending_intents,
            commands::read_text_file,
            commands::write_text_file,
            commands::file_mtime,
            commands::file_size,
            commands::list_dir,
            commands::parent_dir,
            commands::write_binary_file,
            commands::delete_file,
            commands::dir_of,
            assoc::register_md_association,
            assoc::is_md_association_registered,
            assoc::unregister_md_association,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 移动端：Android 通过 VIEW/SEND intent 打开 .md 文件时，
            // tao 在 onCreate（冷启动）或 onNewIntent（已运行）中提取
            // content URI 并触发 RunEvent::Opened { urls }。
            //
            // 冷启动时前端尚未注册事件监听，直接 emit 会丢失，故同时：
            //   1. 把 URL 暂存到 PendingIntents（前端 onMount 后 take 走）
            //   2. emit "mobile-opened" 事件（前端若已就绪则立即处理）
            // 已运行实例（onNewIntent）时前端已就绪，emit 即可生效。
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let url_strings: Vec<String> =
                        urls.iter().map(|u| u.to_string()).collect();
                    if !url_strings.is_empty() {
                        // 兜底：暂存，供前端 onMount 后取走（覆盖冷启动场景）
                        if let Some(state) =
                            app_handle.try_state::<commands::PendingIntents>()
                        {
                            if let Ok(mut g) = state.urls.lock() {
                                g.extend(url_strings.clone());
                            }
                        }
                        // 即时通知：前端已就绪时立即处理（覆盖 onNewIntent 场景）
                        let _ = app_handle.emit("mobile-opened", url_strings);
                    }
                }
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let _ = app_handle;
                let _ = event;
            }
        });
}
