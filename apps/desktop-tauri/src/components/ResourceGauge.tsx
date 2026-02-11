import { cn } from "../lib/utils";
import { getStatusColor } from "../lib/theme";

interface ResourceGaugeProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  percentage: number;
  icon?: React.ReactNode;
}

export default function ResourceGauge({
  label,
  value,
  max,
  unit,
  percentage,
  icon,
}: ResourceGaugeProps) {
  const color = getStatusColor(percentage);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-batcave-text-muted">{icon}</span>
          )}
          <span className="text-sm font-medium text-batcave-text">
            {label}
          </span>
        </div>
        <span className="text-sm font-mono" style={{ color }}>
          {percentage.toFixed(0)}%
        </span>
      </div>

      {/* Bar */}
      <div className="w-full h-2 bg-batcave-tertiary rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${Math.min(percentage, 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>

      {/* Values */}
      <div className="flex items-center justify-between text-xs text-batcave-text-muted">
        <span>
          {value.toFixed(1)} {unit} used
        </span>
        <span>
          {max.toFixed(1)} {unit} total
        </span>
      </div>
    </div>
  );
}
