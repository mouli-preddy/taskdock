use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version.to_string()))
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(
                |chunk, total| {
                    log::info!("Update download: {}/{}", chunk, total.unwrap_or(0));
                },
                || {
                    log::info!("Update download complete, installing...");
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}
