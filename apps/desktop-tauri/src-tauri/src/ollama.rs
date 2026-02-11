use serde::{Deserialize, Serialize};

const OLLAMA_BASE: &str = "http://localhost:11434";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub digest: String,
    pub modified_at: String,
    #[serde(default)]
    pub details: Option<ModelDetails>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelDetails {
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PullProgress {
    pub status: String,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub completed: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub modelfile: Option<String>,
    pub parameters: Option<String>,
    pub template: Option<String>,
    pub details: Option<ModelDetails>,
}

/// Detect if Ollama is running by checking the API root
pub async fn detect_ollama() -> bool {
    match reqwest::get(OLLAMA_BASE).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// List all locally available models
pub async fn list_models() -> Result<Vec<OllamaModel>, String> {
    let url = format!("{}/api/tags", OLLAMA_BASE);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    let tags: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(tags.models)
}

/// Pull (download) a model by name with streaming progress
pub async fn pull_model(name: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/pull", OLLAMA_BASE);

    let body = serde_json::json!({
        "name": name,
        "stream": false
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to pull model: {}", e))?;

    if resp.status().is_success() {
        Ok(format!("Successfully pulled model: {}", name))
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to pull model ({}): {}", status, text))
    }
}

/// Delete a model by name
pub async fn delete_model(name: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/delete", OLLAMA_BASE);

    let body = serde_json::json!({
        "name": name
    });

    let resp = client
        .delete(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to delete model: {}", e))?;

    if resp.status().is_success() {
        Ok(format!("Successfully deleted model: {}", name))
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to delete model ({}): {}", status, text))
    }
}

/// Get detailed information about a specific model
pub async fn get_model_info(name: &str) -> Result<ModelInfo, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/show", OLLAMA_BASE);

    let body = serde_json::json!({
        "name": name
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to get model info: {}", e))?;

    let info: ModelInfo = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse model info: {}", e))?;

    Ok(info)
}
