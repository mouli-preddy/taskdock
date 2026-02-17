use tauri::State;
use std::sync::Mutex;

/// Holds the deep-link URL from cold start (if any)
pub struct InitialDeepLink(pub(crate) Mutex<Option<String>>);

#[tauri::command]
pub fn get_initial_deep_link(
    state: State<'_, InitialDeepLink>,
) -> Option<String> {
    state.0.lock().ok()?.take()
}
