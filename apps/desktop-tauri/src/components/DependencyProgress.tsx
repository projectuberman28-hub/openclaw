import { CheckCircle2, Circle, Loader2 } from "lucide-react";

interface Step {
  label: string;
  status: "pending" | "running" | "completed" | "error";
}

interface DependencyProgressProps {
  steps: Step[];
  title?: string;
}

export default function DependencyProgress({
  steps,
  title,
}: DependencyProgressProps) {
  return (
    <div className="card p-4">
      {title && (
        <h4 className="text-sm font-medium text-batcave-text mb-3">
          {title}
        </h4>
      )}

      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center gap-3">
            {step.status === "completed" && (
              <CheckCircle2 className="w-4 h-4 text-batcave-success shrink-0" />
            )}
            {step.status === "running" && (
              <Loader2 className="w-4 h-4 text-batcave-info animate-spin shrink-0" />
            )}
            {step.status === "pending" && (
              <Circle className="w-4 h-4 text-batcave-text-muted shrink-0" />
            )}
            {step.status === "error" && (
              <div className="w-4 h-4 rounded-full bg-batcave-accent flex items-center justify-center shrink-0">
                <span className="text-white text-xs">!</span>
              </div>
            )}

            <span
              className={`text-sm ${
                step.status === "completed"
                  ? "text-batcave-text"
                  : step.status === "running"
                  ? "text-batcave-text font-medium"
                  : step.status === "error"
                  ? "text-batcave-accent"
                  : "text-batcave-text-muted"
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
