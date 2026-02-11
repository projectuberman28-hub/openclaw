import { Download, CheckCircle2, XCircle } from "lucide-react";

interface ModelDownloadProgressProps {
  modelName: string;
  progress: number;
  status: "downloading" | "completed" | "error";
  error?: string;
}

export default function ModelDownloadProgress({
  modelName,
  progress,
  status,
  error,
}: ModelDownloadProgressProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-3">
        {status === "downloading" && (
          <Download className="w-5 h-5 text-batcave-info animate-bounce" />
        )}
        {status === "completed" && (
          <CheckCircle2 className="w-5 h-5 text-batcave-success" />
        )}
        {status === "error" && (
          <XCircle className="w-5 h-5 text-batcave-accent" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-batcave-text">{modelName}</p>
          <p className="text-xs text-batcave-text-muted">
            {status === "downloading" && `Downloading... ${progress}%`}
            {status === "completed" && "Download complete"}
            {status === "error" && (error || "Download failed")}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-batcave-tertiary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            status === "completed"
              ? "bg-batcave-success"
              : status === "error"
              ? "bg-batcave-accent"
              : "bg-batcave-info"
          }`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}
