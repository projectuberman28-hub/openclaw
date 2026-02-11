import { useHealth } from "../hooks/useHealth";
import { cn } from "../lib/utils";

export default function StatusBar() {
  const { services, gatewayConnected, ollamaConnected } = useHealth(15000);

  const gatewayService = services.find((s) => s.name === "Gateway");
  const ollamaService = services.find((s) => s.name === "Ollama");

  return (
    <footer className="h-7 bg-batcave-secondary border-t border-batcave-border flex items-center px-3 text-xs text-batcave-text-muted shrink-0 select-none">
      {/* Gateway status */}
      <div className="flex items-center gap-1.5 mr-4">
        <span
          className={cn(
            "status-dot",
            gatewayConnected ? "status-dot-healthy" : "status-dot-error"
          )}
        />
        <span>Gateway</span>
        {gatewayService?.port && (
          <span className="text-batcave-text-muted/60">
            :{gatewayService.port}
          </span>
        )}
      </div>

      {/* Ollama status */}
      <div className="flex items-center gap-1.5 mr-4">
        <span
          className={cn(
            "status-dot",
            ollamaConnected ? "status-dot-healthy" : "status-dot-inactive"
          )}
        />
        <span>Ollama</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Privacy indicator */}
      <div className="flex items-center gap-1.5 mr-4">
        <span className="status-dot status-dot-healthy" />
        <span>Local Mode</span>
      </div>

      {/* Model */}
      <div className="text-batcave-text-muted/60">Alfred v3.0.0</div>
    </footer>
  );
}
