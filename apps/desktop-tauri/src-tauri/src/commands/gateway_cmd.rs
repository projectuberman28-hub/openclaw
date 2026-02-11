use tauri::State;
use serde::{Deserialize, Serialize};
use crate::gateway::GatewayState;

#[derive(Debug, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub port: u16,
    pub health: String,
    pub logs: Vec<String>,
}

#[tauri::command]
pub async fn start_gateway(state: State<'_, GatewayState>) -> Result<String, String> {
    crate::gateway::start_gateway(&state).await?;
    Ok("Gateway started successfully".to_string())
}

#[tauri::command]
pub async fn stop_gateway(state: State<'_, GatewayState>) -> Result<String, String> {
    crate::gateway::stop_gateway(&state).await?;
    Ok("Gateway stopped successfully".to_string())
}

#[tauri::command]
pub async fn gateway_status(state: State<'_, GatewayState>) -> Result<GatewayStatus, String> {
    let running = crate::gateway::is_gateway_running(&state).await;
    let logs = crate::gateway::get_gateway_logs(&state).await;

    Ok(GatewayStatus {
        running,
        port: 18789,
        health: if running { "healthy".to_string() } else { "not running".to_string() },
        logs,
    })
}
