use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PrivacyScore {
    pub score: u32,
    pub local_messages: u64,
    pub cloud_messages: u64,
    pub redacted_messages: u64,
    pub total_messages: u64,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub timestamp: String,
    pub action: String,
    pub source: String,
    pub destination: String,
    pub data_type: String,
    pub privacy_level: String,
    pub details: Option<String>,
}

/// Get privacy score from the Gateway API
#[tauri::command]
pub async fn get_privacy_score() -> Result<PrivacyScore, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://127.0.0.1:18789/api/privacy/score")
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<PrivacyScore>()
                .await
                .map_err(|e| format!("Failed to parse privacy score: {}", e))
        }
        Ok(r) => {
            // Gateway returned an error, provide default
            Err(format!("Gateway returned status: {}", r.status()))
        }
        Err(_) => {
            // Gateway not available, return default score
            Ok(PrivacyScore {
                score: 100,
                local_messages: 0,
                cloud_messages: 0,
                redacted_messages: 0,
                total_messages: 0,
                recommendations: vec![
                    "Gateway not connected - all data stays local by default".to_string(),
                ],
            })
        }
    }
}

/// Get audit log entries from the Gateway API
#[tauri::command]
pub async fn get_audit_log(limit: Option<u32>) -> Result<Vec<AuditLogEntry>, String> {
    let limit = limit.unwrap_or(100);
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:18789/api/privacy/audit?limit={}", limit);

    let resp = client.get(&url).send().await;

    match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<AuditLogEntry>>()
                .await
                .map_err(|e| format!("Failed to parse audit log: {}", e))
        }
        Ok(r) => Err(format!("Gateway returned status: {}", r.status())),
        Err(_) => {
            // Gateway not available, return empty log
            Ok(Vec::new())
        }
    }
}
