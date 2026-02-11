use serde::{Deserialize, Serialize};
use sysinfo::System;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuInfo {
    pub name: String,
    pub vram_mb: u64,
    pub driver_version: String,
    pub detected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CpuInfo {
    pub name: String,
    pub cores: usize,
    pub threads: usize,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryInfo {
    pub total_mb: u64,
    pub used_mb: u64,
    pub available_mb: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskInfo {
    pub total_gb: f64,
    pub used_gb: f64,
    pub available_gb: f64,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemSnapshot {
    pub gpu: GpuInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub disk: DiskInfo,
    pub os: String,
    pub hostname: String,
}

/// Detect NVIDIA GPU by parsing nvidia-smi output
pub fn detect_gpu() -> GpuInfo {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let parts: Vec<&str> = stdout.trim().split(", ").collect();

            if parts.len() >= 3 {
                GpuInfo {
                    name: parts[0].trim().to_string(),
                    vram_mb: parts[1].trim().parse().unwrap_or(0),
                    driver_version: parts[2].trim().to_string(),
                    detected: true,
                }
            } else {
                no_gpu()
            }
        }
        Err(_) => no_gpu(),
    }
}

fn no_gpu() -> GpuInfo {
    GpuInfo {
        name: "No NVIDIA GPU detected".to_string(),
        vram_mb: 0,
        driver_version: "N/A".to_string(),
        detected: false,
    }
}

/// Get CPU information via sysinfo crate
pub fn get_cpu_info() -> CpuInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_all();

    let cpus = sys.cpus();
    let name = cpus.first().map(|c| c.brand().to_string()).unwrap_or_else(|| "Unknown".into());
    let cores = sys.physical_core_count().unwrap_or(0);
    let threads = cpus.len();
    let usage: f32 = if !cpus.is_empty() {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    } else {
        0.0
    };

    CpuInfo {
        name,
        cores,
        threads,
        usage_percent: usage,
    }
}

/// Get memory information via sysinfo crate
pub fn get_memory_info() -> MemoryInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total = sys.total_memory() / 1024 / 1024;
    let used = sys.used_memory() / 1024 / 1024;
    let available = sys.available_memory() / 1024 / 1024;
    let usage = if total > 0 {
        (used as f32 / total as f32) * 100.0
    } else {
        0.0
    };

    MemoryInfo {
        total_mb: total,
        used_mb: used,
        available_mb: available,
        usage_percent: usage,
    }
}

/// Get disk information via sysinfo crate
pub fn get_disk_info() -> DiskInfo {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();

    let mut total: u64 = 0;
    let mut available: u64 = 0;

    for disk in disks.list() {
        total += disk.total_space();
        available += disk.available_space();
    }

    let total_gb = total as f64 / 1_073_741_824.0;
    let available_gb = available as f64 / 1_073_741_824.0;
    let used_gb = total_gb - available_gb;
    let usage = if total_gb > 0.0 {
        (used_gb / total_gb * 100.0) as f32
    } else {
        0.0
    };

    DiskInfo {
        total_gb,
        used_gb,
        available_gb,
        usage_percent: usage,
    }
}

/// Get a complete system snapshot
pub fn get_system_snapshot() -> SystemSnapshot {
    let hostname = System::host_name().unwrap_or_else(|| "Unknown".into());
    let os = format!(
        "{} {}",
        System::name().unwrap_or_else(|| "Unknown".into()),
        System::os_version().unwrap_or_else(|| "".into())
    );

    SystemSnapshot {
        gpu: detect_gpu(),
        cpu: get_cpu_info(),
        memory: get_memory_info(),
        disk: get_disk_info(),
        os,
        hostname,
    }
}
