import type { PrivacyLevel } from "../lib/protocol";
import { cn } from "../lib/utils";

interface PrivacyBadgeProps {
  level: PrivacyLevel;
  showLabel?: boolean;
}

const config: Record<PrivacyLevel, { dot: string; label: string; bg: string }> = {
  local: {
    dot: "bg-batcave-success",
    label: "Local",
    bg: "bg-batcave-success/10 text-batcave-success",
  },
  "cloud-redacted": {
    dot: "bg-batcave-warning",
    label: "Cloud (redacted)",
    bg: "bg-batcave-warning/10 text-batcave-warning",
  },
  cloud: {
    dot: "bg-batcave-accent",
    label: "Cloud",
    bg: "bg-batcave-accent/10 text-batcave-accent",
  },
};

export default function PrivacyBadge({
  level,
  showLabel = false,
}: PrivacyBadgeProps) {
  const c = config[level] || config.local;

  if (showLabel) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
          c.bg
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
        {c.label}
      </span>
    );
  }

  return (
    <span
      className={cn("w-1.5 h-1.5 rounded-full inline-block", c.dot)}
      title={c.label}
    />
  );
}
