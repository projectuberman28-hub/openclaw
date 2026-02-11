use serde::{Deserialize, Serialize};
use tauri::State;
use crate::gateway::GatewayState;
use crate::hardware::SystemSnapshot;
use crate::services::ServiceStatus;

#[tauri::command]
pub async fn get_resources() -> Result<SystemSnapshot, String> {
    Ok(crate::hardware::get_system_snapshot())
}

#[tauri::command]
pub async fn get_services_status(
    state: State<'_, GatewayState>,
) -> Result<Vec<ServiceStatus>, String> {
    Ok(crate::services::check_all_services(&state).await)
}
