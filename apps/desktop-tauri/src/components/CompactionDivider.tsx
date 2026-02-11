import { Layers } from "lucide-react";

export default function CompactionDivider() {
  return (
    <div className="flex items-center gap-3 py-3 px-4">
      <div className="flex-1 h-px bg-batcave-border" />
      <div className="flex items-center gap-1.5 text-xs text-batcave-text-muted">
        <Layers className="w-3 h-3" />
        <span>Session compacted</span>
      </div>
      <div className="flex-1 h-px bg-batcave-border" />
    </div>
  );
}
