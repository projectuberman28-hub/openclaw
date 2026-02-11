use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub name: String,
    pub running: bool,
    pub port: Option<u16>,
    pub health: String,
    pub details: Option<String>,
}

/// Auto-start services on app launch
pub async fn auto_start(gateway_state: &crate::gateway::GatewayState) -> Vec<ServiceStatus> {
    let mut statuses = Vec::new();

    // Start Gateway
    match crate::gateway::start_gateway(gateway_state).await {
        Ok(_) => {
            statuses.push(ServiceStatus {
                name: "Gateway".to_string(),
                running: true,
                port: Some(18789),
                health: "starting".to_string(),
                details: Some("Gateway process started".to_string()),
            });
        }
        Err(e) => {
            statuses.push(ServiceStatus {
                name: "Gateway".to_string(),
                running: false,
                port: Some(18789),
                health: "error".to_string(),
                details: Some(e),
            });
        }
    }

    // Check Ollama status (don't start it, just detect)
    let ollama_running = crate::ollama::detect_ollama().await;
    statuses.push(ServiceStatus {
        name: "Ollama".to_string(),
        running: ollama_running,
        port: Some(11434),
        health: if ollama_running { "healthy" } else { "not running" }.to_string(),
        details: None,
    });

    statuses
}

/// Check all service statuses
pub async fn check_all_services(gateway_state: &crate::gateway::GatewayState) -> Vec<ServiceStatus> {
    let mut statuses = Vec::new();

    // Gateway
    let gw_running = crate::gateway::is_gateway_running(gateway_state).await;
    statuses.push(ServiceStatus {
        name: "Gateway".to_string(),
        running: gw_running,
        port: Some(18789),
        health: if gw_running { "healthy" } else { "not running" }.to_string(),
        details: None,
    });

    // Ollama
    let ollama_running = crate::ollama::detect_ollama().await;
    statuses.push(ServiceStatus {
        name: "Ollama".to_string(),
        running: ollama_running,
        port: Some(11434),
        health: if ollama_running { "healthy" } else { "not running" }.to_string(),
        details: None,
    });

    // Docker
    let docker_available = crate::docker::is_docker_available();
    statuses.push(ServiceStatus {
        name: "Docker".to_string(),
        running: docker_available,
        port: None,
        health: if docker_available { "available" } else { "not installed" }.to_string(),
        details: None,
    });

    // SearXNG
    let searxng_running = crate::docker::is_searxng_running();
    statuses.push(ServiceStatus {
        name: "SearXNG".to_string(),
        running: searxng_running,
        port: Some(8888),
        health: if searxng_running { "healthy" } else { "not running" }.to_string(),
        details: None,
    });

    statuses
}
