pub mod commands;
pub mod config;
pub mod docker;
pub mod gateway;
pub mod hardware;
pub mod ollama;
pub mod services;
pub mod tray;
pub mod updater;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let gateway_state = gateway::create_gateway_state();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(gateway_state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Setup system tray
            if let Err(e) = tray::create_tray(&handle) {
                eprintln!("Failed to create system tray: {}", e);
            }

            // Open DevTools in development mode
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Auto-start services in background
            let gw_state = gateway_state.clone();
            let app_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let statuses = services::auto_start(&gw_state).await;
                for status in &statuses {
                    println!(
                        "[startup] {} - {}",
                        status.name,
                        if status.running { "running" } else { "stopped" }
                    );
                }
                // Emit startup complete event to frontend
                let _ = app_handle.emit("services-started", &statuses);
            });

            // Handle window close → hide to tray instead of quit
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        // Register all command handlers
        .invoke_handler(tauri::generate_handler![
            // Onboarding commands
            commands::onboarding::detect_system,
            commands::onboarding::get_recommended_model,
            // Gateway commands
            commands::gateway_cmd::start_gateway,
            commands::gateway_cmd::stop_gateway,
            commands::gateway_cmd::gateway_status,
            // Privacy commands
            commands::privacy::get_privacy_score,
            commands::privacy::get_audit_log,
            // Model commands
            commands::models::list_models,
            commands::models::pull_model,
            commands::models::delete_model,
            // Agent commands
            commands::agents::list_agents,
            commands::agents::create_agent,
            commands::agents::update_agent,
            commands::agents::delete_agent,
            // System commands
            commands::system::get_resources,
            commands::system::get_services_status,
        ])
        .on_window_event(|_window, event| {
            // Graceful shutdown
            if let tauri::WindowEvent::Destroyed = event {
                println!("[shutdown] Window destroyed, cleaning up...");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Alfred desktop application");
}
