const APP_NAME: &str = "TaskDock";
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

#[tauri::command]
pub fn get_autostart_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run_key) = hkcu.open_subkey(RUN_KEY) {
            return run_key.get_value::<String, _>(APP_NAME).is_ok();
        }
    }
    false
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_WRITE)
            .map_err(|e| e.to_string())?;
        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            run_key
                .set_value(APP_NAME, &exe_path)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = run_key.delete_value(APP_NAME);
        }
    }
    Ok(())
}

/// Enable autostart during first-run setup (called from lib.rs, not a Tauri command).
pub fn enable_autostart_internal() -> Result<(), String> {
    set_autostart_enabled(true)
}
