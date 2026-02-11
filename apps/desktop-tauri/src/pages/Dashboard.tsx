import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Monitor,
  MessageSquare,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import ServiceStatusCard from "../components/ServiceStatusCard";
import ResourceGauge from "../components/ResourceGauge";
import { useHealth } from "../hooks/useHealth";
import { tauriInvoke } from "../hooks/useTauri";
import type { SystemSnapshot, ServiceStatus } from "../lib/protocol";

export default function Dashboard() {
  const navigate = useNavigate();
  const { services, refresh: refreshHealth, loading: healthLoading } = useHealth(10000);
  const [resources, setResources] = useState<SystemSnapshot | null>(null);
  const [quickMessage, setQuickMessage] = useState("");

  useEffect(() => {
    loadResources();
    const interval = setInterval(loadResources, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadResources = async () => {
    try {
      const data = await tauriInvoke<SystemSnapshot>("get_resources");
      setResources(data);
    } catch {
      // Tauri may not be ready
    }
  };

  const handleQuickChat = () => {
    if (quickMessage.trim()) {
      navigate("/chat");
    }
  };

  const serviceIcons: Record<string, React.ReactNode> = {
    Gateway: <Server className="w-5 h-5" />,
    Ollama: <Cpu className="w-5 h-5" />,
    Docker: <Monitor className="w-5 h-5" />,
    SearXNG: <HardDrive className="w-5 h-5" />,
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Dashboard</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            System overview and quick actions
          </p>
        </div>
        <button
          onClick={() => {
            refreshHealth();
            loadResources();
          }}
          className="btn-ghost flex items-center gap-2 text-sm"
          disabled={healthLoading}
        >
          <RefreshCw
            className={`w-4 h-4 ${healthLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Quick chat */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-batcave-accent/10 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-batcave-accent" />
          </div>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              value={quickMessage}
              onChange={(e) => setQuickMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickChat()}
              placeholder="Ask Alfred something..."
              className="input-field flex-1"
            />
            <button
              onClick={() => navigate("/chat")}
              className="btn-primary flex items-center gap-2"
            >
              Chat
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Services grid */}
      <div>
        <h2 className="text-lg font-semibold text-batcave-text mb-3">
          Services
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.length > 0 ? (
            services.map((service) => (
              <ServiceStatusCard
                key={service.name}
                service={service}
                icon={serviceIcons[service.name] || <Server className="w-5 h-5" />}
              />
            ))
          ) : (
            // Default state when no services detected yet
            <>
              {["Gateway", "Ollama", "Docker", "SearXNG"].map((name) => (
                <ServiceStatusCard
                  key={name}
                  service={{
                    name,
                    running: false,
                    port: null,
                    health: "checking...",
                  }}
                  icon={serviceIcons[name] || <Server className="w-5 h-5" />}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Resource gauges */}
      <div>
        <h2 className="text-lg font-semibold text-batcave-text mb-3">
          Resources
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResourceGauge
            label="CPU"
            value={resources?.cpu.usage_percent ?? 0}
            max={100}
            unit="%"
            percentage={resources?.cpu.usage_percent ?? 0}
            icon={<Cpu className="w-4 h-4" />}
          />
          <ResourceGauge
            label="RAM"
            value={(resources?.memory.used_mb ?? 0) / 1024}
            max={(resources?.memory.total_mb ?? 1) / 1024}
            unit="GB"
            percentage={resources?.memory.usage_percent ?? 0}
            icon={<MemoryStick className="w-4 h-4" />}
          />
          <ResourceGauge
            label="VRAM"
            value={
              resources?.gpu.detected
                ? resources.gpu.vram_mb / 1024
                : 0
            }
            max={
              resources?.gpu.detected
                ? resources.gpu.vram_mb / 1024
                : 1
            }
            unit="GB"
            percentage={resources?.gpu.detected ? 0 : 0}
            icon={<Monitor className="w-4 h-4" />}
          />
          <ResourceGauge
            label="Disk"
            value={resources?.disk.used_gb ?? 0}
            max={resources?.disk.total_gb ?? 1}
            unit="GB"
            percentage={resources?.disk.usage_percent ?? 0}
            icon={<HardDrive className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* System info */}
      {resources && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-batcave-text mb-3">
            System Info
          </h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-batcave-text-muted">OS</span>
              <span className="text-batcave-text">{resources.os}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-batcave-text-muted">Hostname</span>
              <span className="text-batcave-text">{resources.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-batcave-text-muted">CPU</span>
              <span className="text-batcave-text truncate ml-4">
                {resources.cpu.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-batcave-text-muted">GPU</span>
              <span className="text-batcave-text truncate ml-4">
                {resources.gpu.name}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
