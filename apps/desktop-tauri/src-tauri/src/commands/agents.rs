use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentConfig {
    pub id: Option<String>,
    pub name: String,
    pub model: String,
    pub system_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub tools: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub enabled: bool,
    pub tools_count: usize,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_agents() -> Result<Vec<AgentInfo>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://127.0.0.1:18789/api/agents")
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<AgentInfo>>()
                .await
                .map_err(|e| format!("Failed to parse agents: {}", e))
        }
        Ok(r) => Err(format!("Gateway returned status: {}", r.status())),
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn create_agent(config: AgentConfig) -> Result<AgentInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("http://127.0.0.1:18789/api/agents")
        .json(&config)
        .send()
        .await
        .map_err(|e| format!("Failed to create agent: {}", e))?;

    if resp.status().is_success() {
        resp.json::<AgentInfo>()
            .await
            .map_err(|e| format!("Failed to parse agent response: {}", e))
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to create agent: {}", text))
    }
}

#[tauri::command]
pub async fn update_agent(id: String, config: AgentConfig) -> Result<AgentInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .put(&format!("http://127.0.0.1:18789/api/agents/{}", id))
        .json(&config)
        .send()
        .await
        .map_err(|e| format!("Failed to update agent: {}", e))?;

    if resp.status().is_success() {
        resp.json::<AgentInfo>()
            .await
            .map_err(|e| format!("Failed to parse agent response: {}", e))
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to update agent: {}", text))
    }
}

#[tauri::command]
pub async fn delete_agent(id: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .delete(&format!("http://127.0.0.1:18789/api/agents/{}", id))
        .send()
        .await
        .map_err(|e| format!("Failed to delete agent: {}", e))?;

    if resp.status().is_success() {
        Ok(format!("Agent {} deleted", id))
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to delete agent: {}", text))
    }
}
