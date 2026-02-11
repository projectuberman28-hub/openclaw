import { Loader2, Wrench, CheckCircle2, XCircle } from "lucide-react";
import type { ToolCall } from "../lib/protocol";

interface ToolUseIndicatorProps {
  tool: ToolCall;
}

export default function ToolUseIndicator({ tool }: ToolUseIndicatorProps) {
  const isRunning = tool.status === "running" || tool.status === "pending";
  const isCompleted = tool.status === "completed";
  const isError = tool.status === "error";

  return (
    <div className="py-1 ml-11 animate-fade-in">
      <div className="inline-flex items-center gap-2 bg-batcave-tertiary border border-batcave-border rounded-lg px-3 py-1.5 text-sm">
        {isRunning && (
          <Loader2 className="w-3.5 h-3.5 text-batcave-info animate-spin" />
        )}
        {isCompleted && (
          <CheckCircle2 className="w-3.5 h-3.5 text-batcave-success" />
        )}
        {isError && (
          <XCircle className="w-3.5 h-3.5 text-batcave-accent" />
        )}

        <Wrench className="w-3 h-3 text-batcave-text-muted" />
        <span className="text-batcave-text-muted font-medium">
          {isRunning ? "Using" : isCompleted ? "Used" : "Failed"}{" "}
          <span className="text-batcave-text">{tool.name}</span>
        </span>

        {isRunning && (
          <span className="text-xs text-batcave-text-muted/60">
            working...
          </span>
        )}
      </div>
    </div>
  );
}
