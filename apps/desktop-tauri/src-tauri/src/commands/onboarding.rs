use serde::{Deserialize, Serialize};
use tauri::State;
use crate::gateway::GatewayState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub gpu_name: String,
    pub gpu_vram_mb: u64,
    pub gpu_detected: bool,
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub ram_total_mb: u64,
    pub ram_available_mb: u64,
    pub docker_available: bool,
    pub ollama_running: bool,
    pub os: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelRecommendation {
    pub model_name: String,
    pub display_name: String,
    pub description: String,
    pub size_gb: f64,
    pub recommended: bool,
    pub reason: String,
}

#[tauri::command]
pub async fn detect_system() -> Result<SystemInfo, String> {
    let snapshot = crate::hardware::get_system_snapshot();
    let ollama_running = crate::ollama::detect_ollama().await;
    let docker_available = crate::docker::is_docker_available();

    Ok(SystemInfo {
        gpu_name: snapshot.gpu.name,
        gpu_vram_mb: snapshot.gpu.vram_mb,
        gpu_detected: snapshot.gpu.detected,
        cpu_name: snapshot.cpu.name,
        cpu_cores: snapshot.cpu.cores,
        ram_total_mb: snapshot.memory.total_mb,
        ram_available_mb: snapshot.memory.available_mb,
        docker_available,
        ollama_running,
        os: snapshot.os,
    })
}

#[tauri::command]
pub async fn get_recommended_model(gpu_vram: u64) -> Result<Vec<ModelRecommendation>, String> {
    let mut recommendations = Vec::new();

    if gpu_vram >= 24000 {
        // 24GB+ VRAM - can run large models
        recommendations.push(ModelRecommendation {
            model_name: "qwen2.5:32b".to_string(),
            display_name: "Qwen 2.5 32B".to_string(),
            description: "Powerful reasoning model, excellent for complex tasks".to_string(),
            size_gb: 19.0,
            recommended: true,
            reason: "Your GPU has enough VRAM for large models".to_string(),
        });
        recommendations.push(ModelRecommendation {
            model_name: "deepseek-r1:14b".to_string(),
            display_name: "DeepSeek R1 14B".to_string(),
            description: "Strong reasoning with chain-of-thought".to_string(),
            size_gb: 9.0,
            recommended: false,
            reason: "Great alternative with reasoning capabilities".to_string(),
        });
    } else if gpu_vram >= 8000 {
        // 8-24GB VRAM
        recommendations.push(ModelRecommendation {
            model_name: "qwen2.5:14b".to_string(),
            display_name: "Qwen 2.5 14B".to_string(),
            description: "Balanced performance and quality".to_string(),
            size_gb: 9.0,
            recommended: true,
            reason: "Optimal for your GPU VRAM".to_string(),
        });
        recommendations.push(ModelRecommendation {
            model_name: "llama3.1:8b".to_string(),
            display_name: "Llama 3.1 8B".to_string(),
            description: "Fast and efficient general-purpose model".to_string(),
            size_gb: 4.7,
            recommended: false,
            reason: "Lighter alternative with good performance".to_string(),
        });
    } else if gpu_vram >= 4000 {
        // 4-8GB VRAM
        recommendations.push(ModelRecommendation {
            model_name: "qwen2.5:7b".to_string(),
            display_name: "Qwen 2.5 7B".to_string(),
            description: "Good balance of speed and capability".to_string(),
            size_gb: 4.4,
            recommended: true,
            reason: "Best fit for your VRAM capacity".to_string(),
        });
        recommendations.push(ModelRecommendation {
            model_name: "phi3:mini".to_string(),
            display_name: "Phi-3 Mini".to_string(),
            description: "Compact but capable model from Microsoft".to_string(),
            size_gb: 2.3,
            recommended: false,
            reason: "Lightweight option for limited VRAM".to_string(),
        });
    } else {
        // CPU-only or <4GB VRAM
        recommendations.push(ModelRecommendation {
            model_name: "qwen2.5:3b".to_string(),
            display_name: "Qwen 2.5 3B".to_string(),
            description: "Lightweight model that runs on CPU".to_string(),
            size_gb: 1.9,
            recommended: true,
            reason: "Runs well on CPU with limited GPU resources".to_string(),
        });
        recommendations.push(ModelRecommendation {
            model_name: "tinyllama".to_string(),
            display_name: "TinyLlama".to_string(),
            description: "Extremely lightweight for basic tasks".to_string(),
            size_gb: 0.6,
            recommended: false,
            reason: "Minimal resource requirements".to_string(),
        });
    }

    Ok(recommendations)
}
