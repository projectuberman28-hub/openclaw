import { cn } from "../lib/utils";
import { RefreshCw, ExternalLink } from "lucide-react";
import type { ServiceStatus } from "../lib/protocol";

interface ServiceStatusCardProps {
  service: ServiceStatus;
  icon: React.ReactNode;
  onRestart?: () => void;
  onOpen?: () => void;
}

export default function ServiceStatusCard({
  service,
  icon,
  onRestart,
  onOpen,
}: ServiceStatusCardProps) {
  return (
    <div className="card-hover p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              service.running
                ? "bg-batcave-success/10 text-batcave-success"
                : "bg-batcave-tertiary text-batcave-text-muted"
            )}
          >
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-batcave-text">
              {service.name}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  "status-dot",
                  service.running ? "status-dot-healthy" : "status-dot-error"
                )}
              />
              <span className="text-xs text-batcave-text-muted capitalize">
                {service.health}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onRestart && (
            <button
              onClick={onRestart}
              className="btn-ghost p-1.5"
              title="Restart service"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpen && (
            <button
              onClick={onOpen}
              className="btn-ghost p-1.5"
              title="Open in browser"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {service.port && (
        <div className="text-xs text-batcave-text-muted">
          Port: <span className="text-batcave-text font-mono">{service.port}</span>
        </div>
      )}

      {service.details && (
        <p className="text-xs text-batcave-text-muted mt-1">
          {service.details}
        </p>
      )}
    </div>
  );
}
