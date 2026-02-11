use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    pub size: u64,
    pub size_display: String,
    pub modified_at: String,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
}

#[tauri::command]
pub async fn list_models() -> Result<Vec<ModelEntry>, String> {
    let models = crate::ollama::list_models().await?;

    Ok(models
        .into_iter()
        .map(|m| {
            let size_gb = m.size as f64 / 1_073_741_824.0;
            let size_display = if size_gb >= 1.0 {
                format!("{:.1} GB", size_gb)
            } else {
                format!("{:.0} MB", m.size as f64 / 1_048_576.0)
            };

            ModelEntry {
                name: m.name,
                size: m.size,
                size_display,
                modified_at: m.modified_at,
                family: m.details.as_ref().and_then(|d| d.family.clone()),
                parameter_size: m.details.as_ref().and_then(|d| d.parameter_size.clone()),
                quantization: m.details.as_ref().and_then(|d| d.quantization_level.clone()),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn pull_model(name: String) -> Result<String, String> {
    crate::ollama::pull_model(&name).await
}

#[tauri::command]
pub async fn delete_model(name: String) -> Result<String, String> {
    crate::ollama::delete_model(&name).await
}
