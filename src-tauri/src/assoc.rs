//! Windows 文件关联：将 .md/.markdown/.mdx 关联到本程序。
//! 仅在用户显式点击"设为默认 .md 应用"按钮时调用，不自动执行——
//! 保持绿色软件"不写注册表"的契约，由用户知情同意后写入。
//!
//! 写入位置：HKCU\Software\Classes（当前用户级，无需管理员权限）。
//! - .md / .markdown / .mdx  -> ProgID "VsMReader.md"
//! - HKCU\Software\Classes\VsMReader.md\shell\open\command = "<exe path>" "%1"
//! - 同时写图标与友好名。
//!
//! 关于"双击不生效"：Windows 10/11 的 UserChoice 保护机制会阻止程序
//! 直接抢占"默认应用"。本命令注册 ProgID + open 谓词 + OpenWithProgids，
//! 让本程序出现在"打开方式"列表。但要真正成为"双击默认打开"的应用，
//! 还需写 HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice
//! ——然而该键受系统保护（有 ProgIdHash 校验），程序直接写会被系统忽略。
//! 因此采用两层策略：
//!   1) 写 ProgID + OpenWithProgids（让 MReader 出现在右键"打开方式"且可被选为默认）
//!   2) 调用 Windows shell API 通知系统刷新关联（SHChangeNotify），
//!      并在提示中引导用户：若双击未直接打开，需在系统弹窗确认一次。

use std::path::PathBuf;
use tauri::AppHandle;

/// 关联的扩展名
const EXTS: &[&str] = &["md", "markdown", "mdx"];
/// ProgID（应用标识）
const PROG_ID: &str = "VsMReader.md";
/// 友好类型名
const FRIENDLY_NAME: &str = "Markdown 文档";
/// 可执行文件名（用于 OpenWithList）
const EXE_NAME: &str = "vsmreader.exe";

/// 获取当前 exe 的绝对路径
fn exe_path() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

/// 构造 open 谓词命令行：`"C:\path\vs-md-tool.exe" "%1"`
fn open_command() -> Option<String> {
    let exe = exe_path()?;
    Some(format!("\"{}\" \"%1\"", exe.to_string_lossy()))
}

/// 注册文件关联（当前用户级）。返回是否成功。
#[tauri::command]
pub fn register_md_association(_app: AppHandle) -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let Some(cmd) = open_command() else {
            return false;
        };
        let Some(exe) = exe_path() else {
            return false;
        };
        let icon_value = format!("{},0", exe.to_string_lossy());

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // Software\Classes 可能不存在，create_subkey 会递归创建
        let classes = match hkcu.open_subkey_with_flags("Software\\Classes", KEY_WRITE) {
            Ok(k) => k,
            Err(_) => match hkcu.create_subkey("Software\\Classes") {
                Ok((k, _)) => k,
                Err(_) => return false,
            },
        };

        // 1. 注册 ProgID：Software\Classes\VsMReader.md
        let prog_key = match classes.create_subkey(PROG_ID) {
            Ok((k, _)) => k,
            Err(_) => return false,
        };
        let _ = prog_key.set_value("", &FRIENDLY_NAME.to_string());
        let _ = prog_key.set_value("FriendlyTypeName", &FRIENDLY_NAME.to_string());

        // 图标
        if let Ok((icon_key, _)) = prog_key.create_subkey("DefaultIcon") {
            let _ = icon_key.set_value("", &icon_value);
        }

        // open 谓词
        if let Ok((shell_key, _)) = prog_key.create_subkey("shell") {
            let _ = shell_key.set_value("", &"open".to_string());
            if let Ok((open_key, _)) = shell_key.create_subkey("open") {
                let _ = open_key.set_value("", &"用 VsMReader 打开".to_string());
                if let Ok((cmd_key, _)) = open_key.create_subkey("command") {
                    let _ = cmd_key.set_value("", &cmd);
                }
            }
        }

        // 2. 把扩展名指向 ProgID，并写 OpenWithList / OpenWithProgids
        for ext in EXTS {
            let dot = format!(".{}", ext);
            if let Ok((ext_key, _)) = classes.create_subkey(&dot) {
                let _ = ext_key.set_value("", &PROG_ID.to_string());
                let _ = ext_key.set_value("PerceivedType", &"text".to_string());
                // OpenWithList：右键"打开方式"列表
                if let Ok((owl, _)) = ext_key.create_subkey("OpenWithList") {
                    let _ = owl.create_subkey(EXE_NAME);
                }
                // OpenWithProgids：让本程序成为推荐应用（REG_NONE 类型值）
                if let Ok((owp, _)) = ext_key.create_subkey("OpenWithProgids") {
                    set_reg_none_value(&owp, PROG_ID);
                }
            }
        }

        // 3. 通知系统刷新关联（让资源管理器立即识别）
        notify_shell_assoc_changed();

        true
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn set_reg_none_value(key: &winreg::RegKey, name: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // REG_NONE 的类型常量值为 0
    const REG_NONE_RAW: u32 = 0;

    let name_w: Vec<u16> = OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let hkey = key.raw_handle();
    unsafe {
        extern "system" {
            fn RegSetValueExW(
                hkey: isize,
                lpvaluename: *const u16,
                reserved: u32,
                dwtype: u32,
                lpdata: *const u8,
                cbdata: u32,
            ) -> i32;
        }
        let _ = RegSetValueExW(hkey, name_w.as_ptr(), 0, REG_NONE_RAW, std::ptr::null(), 0);
    }
}

/// 通知系统文件关联已变化（SHChangeNotify），让资源管理器立即刷新。
#[cfg(windows)]
fn notify_shell_assoc_changed() {
    const SHCNE_ASSOCCHANGED: u32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0x0000;
    unsafe {
        extern "system" {
            fn SHChangeNotify(
                weventid: u32,
                uflags: u32,
                dwitem1: *const std::ffi::c_void,
                dwitem2: *const std::ffi::c_void,
            );
        }
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

/// 检查当前是否已注册为 .md 的关联程序（仅检测 ProgID 与 open 谓词是否存在且指向本 exe）。
#[tauri::command]
pub fn is_md_association_registered() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let Some(expected_cmd) = open_command() else {
            return false;
        };
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(cmd_key) = hkcu.open_subkey(format!(
            "Software\\Classes\\{}\\shell\\open\\command",
            PROG_ID
        )) else {
            return false;
        };
        let Ok(val): std::io::Result<String> = cmd_key.get_value("") else {
            return false;
        };
        val.trim().eq_ignore_ascii_case(expected_cmd.trim())
    }

    #[cfg(not(windows))]
    {
        false
    }
}

/// 取消注册（卸载场景或用户想恢复"绿色无痕"）。
#[tauri::command]
pub fn unregister_md_association() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(classes) = hkcu.open_subkey_with_flags("Software\\Classes", KEY_WRITE) else {
            return true; // 没有注册表项视为已取消
        };

        // 删除扩展名映射
        for ext in EXTS {
            let dot = format!(".{}", ext);
            // 先删扩展名下的子键（OpenWithList/OpenWithProgids）
            let _ = delete_subkey_tree(&classes, &dot);
        }
        // 删除 ProgID（递归删除子键后删自身）
        let _ = delete_subkey_tree(&classes, PROG_ID);

        notify_shell_assoc_changed();
        true
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn delete_subkey_tree(parent: &winreg::RegKey, path: &str) -> std::io::Result<()> {
    use winreg::enums::*;
    // 先递归删除所有子键
    if let Ok(sub) = parent.open_subkey_with_flags(path, KEY_READ) {
        let names = sub.enum_keys().filter_map(Result::ok).collect::<Vec<_>>();
        for n in names {
            let child_path = format!("{}\\{}", path, n);
            let _ = delete_subkey_tree(parent, &child_path);
        }
    }
    parent.delete_subkey(path)
}
