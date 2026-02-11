import { useState, useEffect } from "react";
import {
  Save,
  RefreshCw,
  Server,
  Shield,
  Palette,
  Bell,
  Database,
  Loader2,
} from "lucide-react";
import ModelPicker from "../components/ModelPicker";
import { tauriInvoke } from "../hooks/useTauri";
import { cn } from "../lib/utils";

interface Config {
  version: string;
  gateway: { port: number; auto_start: boolean };
  models: { default_model: string; ollama_host: string };
  privacy: { local_only: boolean; redact_cloud: boolean; audit_enabled: boolean };
  channels: { signal: null; discord: null };
  ui: { theme: string; tray_on_close: boolean; start_minimized: boolean };
}

const tabs = [
  { id: "general", label: "General", icon: Server },
  { id: "models", label: "Models", icon: Database },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<
    Array<{ name: string; size_display: string }>
  >([]);

  useEffect(() => {
    loadConfig();
    loadModels();
  }, []);

  const loadConfig = async () => {
    try {
      // Config is read from ALFRED_HOME/alfred.json via the Rust backend
      // For now, use defaults
      setConfig({
        version: "3.0.0",
        gateway: { port: 18789, auto_start: true },
        models: { default_model: "", ollama_host: "http://localhost:11434" },
        privacy: { local_only: true, redact_cloud: true, audit_enabled: true },
        channels: { signal: null, discord: null },
        ui: { theme: "dark", tray_on_close: true, start_minimized: false },
      });
    } catch {
      // Use defaults
    }
  };

  const loadModels = async () => {
    try {
      const result = await tauriInvoke<
        Array<{ name: string; size_display: string }>
      >("list_models");
      setModels(result);
    } catch {
      // Ollama may not be running
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      // Would invoke write_config Tauri command
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (path: string, value: unknown) => {
    if (!config) return;
    const parts = path.split(".");
    const newConfig = { ...config } as any;
    let current = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = { ...current[parts[i]] };
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    setConfig(newConfig);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Settings</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Configure Alfred to your preferences
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Changes
        </button>
      </div>

      <div className="flex gap-6">
        {/* Tab navigation */}
        <div className="w-48 shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-batcave-accent/10 text-batcave-accent"
                    : "text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover"
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1">
          {activeTab === "general" && config && (
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Gateway
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                      Port
                    </label>
                    <input
                      type="number"
                      value={config.gateway.port}
                      onChange={(e) =>
                        updateConfig("gateway.port", parseInt(e.target.value))
                      }
                      className="input-field w-32"
                    />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.gateway.auto_start}
                      onChange={(e) =>
                        updateConfig("gateway.auto_start", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <span className="text-sm text-batcave-text">
                      Auto-start Gateway on launch
                    </span>
                  </label>
                </div>
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Window Behavior
                </h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.ui.tray_on_close}
                      onChange={(e) =>
                        updateConfig("ui.tray_on_close", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <span className="text-sm text-batcave-text">
                      Minimize to system tray on close
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.ui.start_minimized}
                      onChange={(e) =>
                        updateConfig("ui.start_minimized", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <span className="text-sm text-batcave-text">
                      Start minimized to tray
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "models" && config && (
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Default Model
                </h3>
                <ModelPicker
                  value={config.models.default_model}
                  onChange={(model) =>
                    updateConfig("models.default_model", model)
                  }
                />
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Ollama Configuration
                </h3>
                <div>
                  <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                    Ollama Host
                  </label>
                  <input
                    type="text"
                    value={config.models.ollama_host}
                    onChange={(e) =>
                      updateConfig("models.ollama_host", e.target.value)
                    }
                    className="input-field w-full"
                    placeholder="http://localhost:11434"
                  />
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-batcave-text">
                    Installed Models
                  </h3>
                  <button
                    onClick={loadModels}
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                </div>
                {models.length > 0 ? (
                  <div className="space-y-2">
                    {models.map((m) => (
                      <div
                        key={m.name}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-batcave-tertiary"
                      >
                        <span className="text-sm text-batcave-text font-mono">
                          {m.name}
                        </span>
                        <span className="text-xs text-batcave-text-muted">
                          {m.size_display}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-batcave-text-muted">
                    No models installed. Install one via Ollama.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "privacy" && config && (
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Privacy Settings
                </h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.privacy.local_only}
                      onChange={(e) =>
                        updateConfig("privacy.local_only", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <div>
                      <span className="text-sm text-batcave-text block">
                        Local-only mode
                      </span>
                      <span className="text-xs text-batcave-text-muted">
                        Never send data to cloud providers
                      </span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.privacy.redact_cloud}
                      onChange={(e) =>
                        updateConfig("privacy.redact_cloud", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <div>
                      <span className="text-sm text-batcave-text block">
                        Redact sensitive data for cloud
                      </span>
                      <span className="text-xs text-batcave-text-muted">
                        Auto-redact PII before sending to cloud models
                      </span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.privacy.audit_enabled}
                      onChange={(e) =>
                        updateConfig("privacy.audit_enabled", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-batcave-border text-batcave-accent focus:ring-batcave-accent bg-batcave-tertiary"
                    />
                    <div>
                      <span className="text-sm text-batcave-text block">
                        Enable audit logging
                      </span>
                      <span className="text-xs text-batcave-text-muted">
                        Log all data routing decisions
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-batcave-text mb-4">
                  Theme
                </h3>
                <div className="flex gap-3">
                  <button className="card-hover p-4 flex-1 text-center border-batcave-accent ring-1 ring-batcave-accent/20">
                    <div className="w-full h-12 rounded-lg bg-batcave-primary border border-batcave-border mb-2" />
                    <span className="text-sm text-batcave-text">Dark</span>
                  </button>
                  <button className="card-hover p-4 flex-1 text-center opacity-50 cursor-not-allowed">
                    <div className="w-full h-12 rounded-lg bg-gray-100 border border-gray-200 mb-2" />
                    <span className="text-sm text-batcave-text-muted">
                      Light (Coming Soon)
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
