use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod commands;

// Store the backend process handle
static BACKEND_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

fn spawn_backend() -> Result<Child, std::io::Error> {
    // Get the directory where the executable is running
    let current_exe = std::env::current_exe()?;
    let exe_dir = current_exe.parent().unwrap_or(std::path::Path::new("."));
    
    // In development, run via npx tsx from the project root
    // In production, run the bundled sidecar binary
    if cfg!(debug_assertions) {
        // Find the project root (go up from src-tauri/target/debug)
        let project_root = exe_dir
            .ancestors()
            .nth(3)
            .unwrap_or(std::path::Path::new("."));
        
        log::info!("Starting backend from project root: {:?}", project_root);
        
        Command::new("npx")
            .args(["tsx", "src-backend/bridge.ts"])
            .current_dir(project_root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    } else {
        // In production, run the bundled sidecar binary (pkg-bundled Node.js)
        #[cfg(target_os = "windows")]
        let backend_name = "backend.exe";
        #[cfg(not(target_os = "windows"))]
        let backend_name = "backend";

        let backend_path = exe_dir.join(backend_name);
        log::info!("Starting backend sidecar from: {:?}", backend_path);

        let mut cmd = Command::new(backend_path);
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null());

        // Hide console window on Windows
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.spawn()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::storage::load_config,
            commands::storage::save_config,
            commands::storage::is_configured,
            commands::storage::get_store_value,
            commands::storage::set_store_value,
            commands::storage::get_console_review_settings,
            commands::storage::set_console_review_settings,
            commands::storage::get_polling_settings,
            commands::storage::set_polling_settings,
            commands::file_io::read_review_output,
        ])
        .setup(|app| {
            // Start the Node.js backend
            match spawn_backend() {
                Ok(child) => {
                    *BACKEND_PROCESS.lock().unwrap() = Some(child);
                    log::info!("Backend process started with PID: {:?}", 
                        BACKEND_PROCESS.lock().unwrap().as_ref().map(|c| c.id()));
                }
                Err(e) => {
                    log::error!("Failed to start backend: {}", e);
                }
            }

            // Configure logging with file output and rotation
            let log_plugin = tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("taskdock".to_string()),
                    }),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .max_file_size(50_000_000) // 50MB
                .build();

            app.handle().plugin(log_plugin)?;
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the backend process when the window closes
                if let Ok(mut guard) = BACKEND_PROCESS.lock() {
                    if let Some(ref mut child) = *guard {
                        log::info!("Killing backend process");
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
