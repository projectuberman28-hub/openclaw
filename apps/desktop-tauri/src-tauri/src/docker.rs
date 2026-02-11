use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: String,
    pub running: bool,
}

/// Check if Docker is available and running
pub fn is_docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Start a SearXNG container with proper configuration
pub fn start_searxng() -> Result<String, String> {
    let output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name", "alfred-searxng",
            "-p", "8888:8080",
            "-e", "SEARXNG_BASE_URL=http://localhost:8888",
            "--restart", "unless-stopped",
            "searxng/searxng:latest",
        ])
        .output()
        .map_err(|e| format!("Failed to start SearXNG: {}", e))?;

    if output.status.success() {
        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(format!("SearXNG started with container ID: {}", id))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to start SearXNG: {}", err))
    }
}

/// Stop the SearXNG container
pub fn stop_searxng() -> Result<String, String> {
    let output = Command::new("docker")
        .args(["stop", "alfred-searxng"])
        .output()
        .map_err(|e| format!("Failed to stop SearXNG: {}", e))?;

    if output.status.success() {
        // Also remove the container
        let _ = Command::new("docker").args(["rm", "alfred-searxng"]).output();
        Ok("SearXNG stopped".to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to stop SearXNG: {}", err))
    }
}

/// Check if the SearXNG container is running
pub fn is_searxng_running() -> bool {
    let output = Command::new("docker")
        .args(["ps", "--filter", "name=alfred-searxng", "--format", "{{.Status}}"])
        .output();

    match output {
        Ok(o) => {
            let status = String::from_utf8_lossy(&o.stdout);
            status.trim().contains("Up")
        }
        Err(_) => false,
    }
}

/// Start a signal-cli-rest container
pub fn start_signal_cli() -> Result<String, String> {
    let data_dir = crate::config::get_alfred_home().join("signal-cli");
    std::fs::create_dir_all(&data_dir).ok();

    let output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name", "alfred-signal-cli",
            "-p", "8820:8080",
            "-v", &format!("{}:/home/.local/share/signal-cli", data_dir.to_string_lossy()),
            "--restart", "unless-stopped",
            "bbernhard/signal-cli-rest-api:latest",
        ])
        .output()
        .map_err(|e| format!("Failed to start signal-cli: {}", e))?;

    if output.status.success() {
        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(format!("signal-cli started with container ID: {}", id))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to start signal-cli: {}", err))
    }
}

/// List all Alfred-related Docker containers
pub fn list_containers() -> Result<Vec<ContainerInfo>, String> {
    let output = Command::new("docker")
        .args([
            "ps",
            "-a",
            "--filter", "name=alfred-",
            "--format", "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}",
        ])
        .output()
        .map_err(|e| format!("Failed to list containers: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let containers: Vec<ContainerInfo> = stdout
        .trim()
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            ContainerInfo {
                id: parts.first().unwrap_or(&"").to_string(),
                name: parts.get(1).unwrap_or(&"").to_string(),
                image: parts.get(2).unwrap_or(&"").to_string(),
                status: parts.get(3).unwrap_or(&"").to_string(),
                ports: parts.get(4).unwrap_or(&"").to_string(),
                running: parts.get(3).unwrap_or(&"").contains("Up"),
            }
        })
        .collect();

    Ok(containers)
}
