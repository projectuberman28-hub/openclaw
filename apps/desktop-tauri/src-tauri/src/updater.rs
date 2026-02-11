use serde::{Deserialize, Serialize};

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/archon/alfred-v3/releases/latest";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Check GitHub Releases API for available updates
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .user_agent("Alfred-Desktop/3.0.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(GITHUB_RELEASES_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    if !resp.status().is_success() {
        return Ok(UpdateInfo {
            available: false,
            current_version,
            latest_version: "unknown".to_string(),
            download_url: None,
            release_notes: None,
            published_at: None,
        });
    }

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let available = is_newer_version(&current_version, &latest_version);

    // Find the appropriate asset for the current platform
    let download_url = find_platform_asset(&release.assets);

    Ok(UpdateInfo {
        available,
        current_version,
        latest_version,
        download_url,
        release_notes: release.body,
        published_at: release.published_at,
    })
}

/// Simple semver comparison: returns true if latest > current
fn is_newer_version(current: &str, latest: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };

    let curr = parse(current);
    let lat = parse(latest);

    for i in 0..3 {
        let c = curr.get(i).unwrap_or(&0);
        let l = lat.get(i).unwrap_or(&0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }

    false
}

/// Find the download asset for the current platform
fn find_platform_asset(assets: &[GitHubAsset]) -> Option<String> {
    let target = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };

    assets
        .iter()
        .find(|a| a.name.to_lowercase().contains(target))
        .map(|a| a.browser_download_url.clone())
}
