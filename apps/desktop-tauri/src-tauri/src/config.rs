use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlfredConfig {
    #[serde(default = "default_version")]
    pub version: String,

    #[serde(default)]
    pub gateway: GatewayConfig,

    #[serde(default)]
    pub models: ModelsConfig,

    #[serde(default)]
    pub privacy: PrivacyConfig,

    #[serde(default)]
    pub channels: ChannelsConfig,

    #[serde(default)]
    pub ui: UiConfig,
}

fn default_version() -> String {
    "3.0.0".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GatewayConfig {
    #[serde(default = "default_gateway_port")]
    pub port: u16,

    #[serde(default)]
    pub auto_start: bool,
}

fn default_gateway_port() -> u16 {
    18789
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelsConfig {
    #[serde(default)]
    pub default_model: String,

    #[serde(default)]
    pub ollama_host: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PrivacyConfig {
    #[serde(default = "default_true")]
    pub local_only: bool,

    #[serde(default = "default_true")]
    pub redact_cloud: bool,

    #[serde(default = "default_true")]
    pub audit_enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ChannelsConfig {
    #[serde(default)]
    pub signal: Option<SignalConfig>,

    #[serde(default)]
    pub discord: Option<DiscordConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignalConfig {
    pub enabled: bool,
    pub phone_number: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordConfig {
    pub enabled: bool,
    pub bot_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UiConfig {
    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default = "default_true")]
    pub tray_on_close: bool,

    #[serde(default)]
    pub start_minimized: bool,
}

fn default_theme() -> String {
    "dark".to_string()
}

impl Default for AlfredConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            gateway: GatewayConfig::default(),
            models: ModelsConfig::default(),
            privacy: PrivacyConfig::default(),
            channels: ChannelsConfig::default(),
            ui: UiConfig::default(),
        }
    }
}

/// Get the ALFRED_HOME directory, defaulting to ~/.alfred
pub fn get_alfred_home() -> PathBuf {
    if let Ok(home) = std::env::var("ALFRED_HOME") {
        PathBuf::from(home)
    } else if let Some(home) = dirs::home_dir() {
        home.join(".alfred")
    } else {
        PathBuf::from(".alfred")
    }
}

/// Read the alfred.json configuration from ALFRED_HOME
pub fn read_config() -> Result<AlfredConfig, String> {
    let config_path = get_alfred_home().join("alfred.json");

    if !config_path.exists() {
        // Return default config if file doesn't exist
        return Ok(AlfredConfig::default());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: AlfredConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config)
}

/// Write the configuration to alfred.json in ALFRED_HOME
pub fn write_config(config: &AlfredConfig) -> Result<(), String> {
    let alfred_home = get_alfred_home();
    std::fs::create_dir_all(&alfred_home)
        .map_err(|e| format!("Failed to create ALFRED_HOME: {}", e))?;

    let config_path = alfred_home.join("alfred.json");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}
