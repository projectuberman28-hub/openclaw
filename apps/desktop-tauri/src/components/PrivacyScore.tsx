import { cn } from "../lib/utils";

interface PrivacyScoreProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export default function PrivacyScore({ score, size = "md" }: PrivacyScoreProps) {
  const dimensions = {
    sm: { width: 80, stroke: 6, fontSize: "text-lg" },
    md: { width: 120, stroke: 8, fontSize: "text-2xl" },
    lg: { width: 160, stroke: 10, fontSize: "text-4xl" },
  };

  const dim = dimensions[size];
  const radius = (dim.width - dim.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = () => {
    if (score >= 80) return "#22c55e";
    if (score >= 50) return "#eab308";
    return "#dc2626";
  };

  const getLabel = () => {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Very Good";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Attention";
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: dim.width, height: dim.width }}>
        <svg
          width={dim.width}
          height={dim.width}
          className="-rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={dim.width / 2}
            cy={dim.width / 2}
            r={radius}
            fill="none"
            stroke="#2a2a35"
            strokeWidth={dim.stroke}
          />
          {/* Score arc */}
          <circle
            cx={dim.width / 2}
            cy={dim.width / 2}
            r={radius}
            fill="none"
            stroke={getColor()}
            strokeWidth={dim.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold text-batcave-text", dim.fontSize)}>
            {score}
          </span>
        </div>
      </div>
      <span className="text-sm text-batcave-text-muted mt-2">
        {getLabel()}
      </span>
    </div>
  );
}
