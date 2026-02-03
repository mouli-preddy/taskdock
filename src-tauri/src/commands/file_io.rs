use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewOutput {
    pub review: Option<Value>,
    pub walkthrough: Option<Value>,
}

/// Validates that a context path is safe to read from
/// Prevents path traversal attacks
fn validate_context_path(path: &str) -> Result<PathBuf, String> {
    let path_buf = PathBuf::from(path);

    // Convert to absolute path and resolve symlinks
    let abs_path = match path_buf.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // If canonicalize fails, the path might not exist yet
            // Just ensure it doesn't contain suspicious patterns
            if path.contains("..") {
                return Err("Path contains invalid traversal patterns".to_string());
            }
            path_buf
        }
    };

    // Ensure the path doesn't contain ".." components
    if abs_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Path contains invalid traversal patterns".to_string());
    }

    Ok(abs_path)
}

/// Reads review and walkthrough output from a context path
/// Returns both files if they exist, null for missing files
#[tauri::command]
pub fn read_review_output(context_path: String) -> Result<ReviewOutput, String> {
    // Validate the context path
    let base_path = validate_context_path(&context_path)?;

    let output_dir = base_path.join("output");
    let review_path = output_dir.join("review.json");
    let walkthrough_path = output_dir.join("walkthrough.json");

    // Read review.json if it exists
    let review = if review_path.exists() {
        match fs::read_to_string(&review_path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(val) => Some(val),
                Err(e) => {
                    log::error!("Failed to parse review.json: {}", e);
                    None
                }
            },
            Err(e) => {
                log::error!("Failed to read review.json: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Read walkthrough.json if it exists
    let walkthrough = if walkthrough_path.exists() {
        match fs::read_to_string(&walkthrough_path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(val) => Some(val),
                Err(e) => {
                    log::error!("Failed to parse walkthrough.json: {}", e);
                    None
                }
            },
            Err(e) => {
                log::error!("Failed to read walkthrough.json: {}", e);
                None
            }
        }
    } else {
        None
    };

    Ok(ReviewOutput {
        review,
        walkthrough,
    })
}
