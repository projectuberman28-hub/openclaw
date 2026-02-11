import { useState } from "react";
import { Terminal, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface ExecApprovalProps {
  command: string;
  description?: string;
  onApprove: () => void;
  onDeny: () => void;
}

export default function ExecApproval({
  command,
  description,
  onApprove,
  onDeny,
}: ExecApprovalProps) {
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null);

  const handleApprove = () => {
    setDecided("approved");
    onApprove();
  };

  const handleDeny = () => {
    setDecided("denied");
    onDeny();
  };

  return (
    <div className="card border-batcave-warning/30 p-4 my-2 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-batcave-warning" />
        <span className="text-sm font-medium text-batcave-warning">
          Command Execution Request
        </span>
      </div>

      {description && (
        <p className="text-sm text-batcave-text-muted mb-3">{description}</p>
      )}

      {/* Command display */}
      <div className="bg-batcave-primary rounded-lg p-3 mb-4 border border-batcave-border">
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="w-3.5 h-3.5 text-batcave-text-muted" />
          <span className="text-xs text-batcave-text-muted">Command</span>
        </div>
        <pre className="text-sm font-mono text-batcave-text whitespace-pre-wrap break-all">
          {command}
        </pre>
      </div>

      {/* Actions */}
      {!decided ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve
          </button>
          <button
            onClick={handleDeny}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <XCircle className="w-4 h-4" />
            Deny
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {decided === "approved" ? (
            <span className="flex items-center gap-1.5 text-sm text-batcave-success">
              <CheckCircle2 className="w-4 h-4" />
              Approved
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-batcave-accent">
              <XCircle className="w-4 h-4" />
              Denied
            </span>
          )}
        </div>
      )}
    </div>
  );
}
