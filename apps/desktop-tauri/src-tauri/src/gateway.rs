use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

pub struct GatewayProcess {
    child: Option<Child>,
    logs: Vec<String>,
}

impl GatewayProcess {
    pub fn new() -> Self {
        Self {
            child: None,
            logs: Vec::new(),
        }
    }
}

pub type GatewayState = Arc<Mutex<GatewayProcess>>;

pub fn create_gateway_state() -> GatewayState {
    Arc::new(Mutex::new(GatewayProcess::new()))
}

/// Start the Gateway as a child process using npx tsx
pub async fn start_gateway(state: &GatewayState) -> Result<(), String> {
    let mut gw = state.lock().await;

    if gw.child.is_some() {
        return Err("Gateway is already running".into());
    }

    let alfred_home = crate::config::get_alfred_home();
    let gateway_path = alfred_home.join("gateway").join("src").join("index.ts");

    // Try npx tsx first, fallback to node
    let mut cmd = Command::new("npx");
    cmd.arg("tsx")
        .arg(gateway_path.to_string_lossy().to_string())
        .env("ALFRED_HOME", alfred_home.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match cmd.spawn() {
        Ok(child) => {
            gw.child = Some(child);
            gw.logs.push("[gateway] Started successfully".to_string());
            Ok(())
        }
        Err(e) => Err(format!("Failed to start Gateway: {}", e)),
    }
}

/// Stop the Gateway child process
pub async fn stop_gateway(state: &GatewayState) -> Result<(), String> {
    let mut gw = state.lock().await;

    if let Some(ref mut child) = gw.child {
        child.kill().await.map_err(|e| format!("Failed to kill Gateway: {}", e))?;
        gw.child = None;
        gw.logs.push("[gateway] Stopped".to_string());
        Ok(())
    } else {
        Err("Gateway is not running".into())
    }
}

/// Check if the Gateway process is alive and health endpoint responds
pub async fn is_gateway_running(state: &GatewayState) -> bool {
    let gw = state.lock().await;

    if gw.child.is_none() {
        return false;
    }

    // Also check the health endpoint
    match reqwest::get("http://127.0.0.1:18789/health").await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Get recent log output from the Gateway
pub async fn get_gateway_logs(state: &GatewayState) -> Vec<String> {
    let gw = state.lock().await;
    gw.logs.clone()
}
