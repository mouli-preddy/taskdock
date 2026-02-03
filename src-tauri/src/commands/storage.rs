use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub ado: AdoConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdoConfig {
    pub organization: String,
    pub project: String,
    pub pat: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedRepository {
    pub path: String,
    pub origin_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitoredRepository {
    pub url: String,
    pub name: String,
    pub organization: String,
    pub project: String,
    pub repository: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApplyChangesSettings {
    pub provider: String,
    pub show_terminal: bool,
    pub timeout_minutes: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeCommentsSettings {
    pub provider: String,
    pub show_terminal: bool,
    pub timeout_minutes: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleReviewSettings {
    pub linked_repositories: Vec<LinkedRepository>,
    pub monitored_repositories: Vec<MonitoredRepository>,
    pub when_repo_found: String,
    pub when_repo_not_found: String,
    pub auto_close_terminal: bool,
    pub show_notification: bool,
    pub worktree_cleanup: String,
    pub generated_file_patterns: Vec<String>,
    pub apply_changes: ApplyChangesSettings,
    pub analyze_comments: AnalyzeCommentsSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PollingSettings {
    pub enabled: bool,
    pub interval_seconds: u32,
}

fn get_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".taskdock"))
}

fn get_config_file() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("config.json"))
}

fn get_store_file() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("store.json"))
}

fn ensure_config_dir() -> Result<(), String> {
    let dir = get_config_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(())
}

// Helper to get nested value using dot notation
fn get_nested_value(data: &Value, key: &str) -> Option<Value> {
    let keys: Vec<&str> = key.split('.').collect();
    let mut current = data;

    for k in keys {
        current = current.get(k)?;
    }

    Some(current.clone())
}

// Helper to set nested value using dot notation
fn set_nested_value(data: &mut Value, key: &str, value: Value) -> Result<(), String> {
    let keys: Vec<&str> = key.split('.').collect();

    if keys.len() == 1 {
        if let Some(obj) = data.as_object_mut() {
            obj.insert(keys[0].to_string(), value);
            return Ok(());
        }
        return Err("Root value is not an object".to_string());
    }

    let mut current = data;
    for (i, k) in keys.iter().enumerate() {
        if i == keys.len() - 1 {
            if let Some(obj) = current.as_object_mut() {
                obj.insert(k.to_string(), value);
                return Ok(());
            }
            return Err("Parent is not an object".to_string());
        } else {
            if !current.get(k).is_some() {
                if let Some(obj) = current.as_object_mut() {
                    obj.insert(k.to_string(), Value::Object(serde_json::Map::new()));
                }
            }
            current = current.get_mut(k).ok_or("Failed to traverse path")?;
        }
    }

    Ok(())
}

// Load store data from disk
fn load_store_data() -> Result<Value, String> {
    let store_file = get_store_file()?;

    if store_file.exists() {
        let content = fs::read_to_string(&store_file)
            .map_err(|e| format!("Failed to read store file: {}", e))?;
        let data: Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse store file: {}", e))?;
        Ok(data)
    } else {
        // Return default store structure
        Ok(serde_json::json!({
            "organization": "",
            "project": "",
            "theme": "system",
            "diffViewMode": "unified",
            "sidebarCollapsed": false,
            "windowBounds": { "width": 1400, "height": 900 },
            "consoleReview": {
                "linkedRepositories": [],
                "monitoredRepositories": [],
                "whenRepoFound": "worktree",
                "whenRepoNotFound": "immediate",
                "autoCloseTerminal": true,
                "showNotification": true,
                "worktreeCleanup": "auto",
                "generatedFilePatterns": [],
                "applyChanges": {
                    "provider": "claude-terminal",
                    "showTerminal": false,
                    "timeoutMinutes": 5
                },
                "analyzeComments": {
                    "provider": "claude-sdk",
                    "showTerminal": false,
                    "timeoutMinutes": 5
                }
            },
            "polling": {
                "enabled": true,
                "intervalSeconds": 30
            },
            "workItems": {
                "savedQueries": [],
                "lastView": "assigned"
            }
        }))
    }
}

// Save store data to disk
fn save_store_data(data: &Value) -> Result<(), String> {
    ensure_config_dir()?;
    let store_file = get_store_file()?;
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize store: {}", e))?;
    fs::write(&store_file, content)
        .map_err(|e| format!("Failed to write store file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let config_file = get_config_file()?;

    if !config_file.exists() {
        return Err("Config file not found".to_string());
    }

    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config)
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    ensure_config_dir()?;
    let config_file = get_config_file()?;

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn is_configured() -> Result<bool, String> {
    match load_config() {
        Ok(config) => Ok(!config.ado.organization.is_empty() && !config.ado.project.is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn get_store_value(key: String) -> Result<Value, String> {
    let data = load_store_data()?;
    get_nested_value(&data, &key).ok_or(format!("Key not found: {}", key))
}

#[tauri::command]
pub fn set_store_value(key: String, value: Value) -> Result<(), String> {
    let mut data = load_store_data()?;
    set_nested_value(&mut data, &key, value)?;
    save_store_data(&data)?;
    Ok(())
}

#[tauri::command]
pub fn get_console_review_settings() -> Result<ConsoleReviewSettings, String> {
    let data = load_store_data()?;
    let settings_value = get_nested_value(&data, "consoleReview")
        .ok_or("Console review settings not found")?;

    let settings: ConsoleReviewSettings = serde_json::from_value(settings_value)
        .map_err(|e| format!("Failed to parse console review settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub fn set_console_review_settings(settings: ConsoleReviewSettings) -> Result<(), String> {
    let mut data = load_store_data()?;
    let settings_value = serde_json::to_value(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    set_nested_value(&mut data, "consoleReview", settings_value)?;
    save_store_data(&data)?;
    Ok(())
}

#[tauri::command]
pub fn get_polling_settings() -> Result<PollingSettings, String> {
    let data = load_store_data()?;
    let settings_value = get_nested_value(&data, "polling")
        .ok_or("Polling settings not found")?;

    let settings: PollingSettings = serde_json::from_value(settings_value)
        .map_err(|e| format!("Failed to parse polling settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub fn set_polling_settings(settings: PollingSettings) -> Result<(), String> {
    let mut data = load_store_data()?;
    let settings_value = serde_json::to_value(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    set_nested_value(&mut data, "polling", settings_value)?;
    save_store_data(&data)?;
    Ok(())
}
