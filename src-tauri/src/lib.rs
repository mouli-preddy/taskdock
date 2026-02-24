use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod commands;

const BACKEND_PORT: u16 = 5198;

// Store the backend process handle
static BACKEND_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
// Flag to stop the monitor thread on shutdown
static SHOULD_MONITOR: AtomicBool = AtomicBool::new(true);

/// Check if the backend is already listening on its port
fn is_backend_running() -> bool {
    TcpStream::connect(("127.0.0.1", BACKEND_PORT)).is_ok()
}

/// Check if the backend process is still running, restart if it died
fn check_and_restart_backend() {
    let mut guard = match BACKEND_PROCESS.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let needs_restart = match guard.as_mut() {
        Some(child) => {
            // try_wait returns Ok(Some(status)) if the process has exited
            match child.try_wait() {
                Ok(Some(status)) => {
                    log::warn!("Backend process exited with status: {:?}", status);
                    true
                }
                Ok(None) => false, // Still running
                Err(e) => {
                    log::error!("Error checking backend process status: {}", e);
                    true // Assume it needs restart on error
                }
            }
        }
        None => true, // No process exists, need to start one
    };

    if needs_restart {
        if is_backend_running() {
            // Backend already running externally (e.g. dev server), skip spawn
            *guard = None; // Clear stale handle so we don't keep polling a dead child
            return;
        }
        log::info!("Restarting backend process...");
        match spawn_backend() {
            Ok(child) => {
                log::info!("Backend process restarted with PID: {:?}", child.id());
                *guard = Some(child);
            }
            Err(e) => {
                log::error!("Failed to restart backend: {}", e);
            }
        }
    }
}

/// Start a background thread that monitors the backend process
fn start_backend_monitor() {
    thread::spawn(|| {
        // Wait a bit before starting to monitor
        thread::sleep(Duration::from_secs(5));

        while SHOULD_MONITOR.load(Ordering::Relaxed) {
            check_and_restart_backend();
            // Check every 5 seconds
            thread::sleep(Duration::from_secs(5));
        }
        log::info!("Backend monitor thread stopped");
    });
}

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
        
        #[cfg(target_os = "windows")]
        let npx = "npx.cmd";
        #[cfg(not(target_os = "windows"))]
        let npx = "npx";

        Command::new(npx)
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
    use commands::deep_link::InitialDeepLink;

    let initial_url = std::env::args()
        .find(|arg| arg.starts_with("taskdock://"));

    tauri::Builder::default()
        .manage(InitialDeepLink(Mutex::new(initial_url)))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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
            commands::storage::get_notification_settings,
            commands::storage::set_notification_settings,
            commands::storage::get_services,
            commands::storage::set_services,
            commands::file_io::read_review_output,
            commands::deep_link::get_initial_deep_link,
        ])
        .setup(|app| {
            // Register deep-link schemes for development
            // (production installer handles this automatically)
            #[cfg(debug_assertions)]
            if let Err(e) = app.deep_link().register_all() {
                log::error!("Failed to register deep-link schemes: {}", e);
            }

            // Start the Node.js backend (skip if already running, e.g. via `npm run dev`)
            if is_backend_running() {
                // Backend already running (e.g. dev server), skip spawn
            } else {
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
            }

            // Start the backend monitor thread for auto-restart
            start_backend_monitor();

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
                // Stop the monitor thread first to prevent restart attempts
                SHOULD_MONITOR.store(false, Ordering::Relaxed);

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
