import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number; // 0-100
  label: string;
  size?: "sm" | "md" | "lg";
  animated?: boolean;
  className?: string;
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function scoreToColor(score: number): string {
  if (score >= 80) return "oklch(0.72 0.19 155)"; // Green
  if (score >= 60) return "oklch(0.75 0.18 85)"; // Yellow/amber
  if (score >= 40) return "oklch(0.70 0.18 50)"; // Orange
  return "oklch(0.65 0.22 25)"; // Red
}

function scoreToTrailColor(score: number): string {
  if (score >= 80) return "oklch(0.72 0.19 155 / 0.15)";
  if (score >= 60) return "oklch(0.75 0.18 85 / 0.15)";
  if (score >= 40) return "oklch(0.70 0.18 50 / 0.15)";
  return "oklch(0.65 0.22 25 / 0.15)";
}

const SIZES = {
  sm: { r: 36, stroke: 5, textSize: "text-lg", labelSize: "text-[10px]", gradeSize: "text-[9px]" },
  md: { r: 50, stroke: 6, textSize: "text-2xl", labelSize: "text-xs", gradeSize: "text-[10px]" },
  lg: { r: 64, stroke: 8, textSize: "text-3xl", labelSize: "text-sm", gradeSize: "text-xs" },
};

export function ScoreGauge({
  score,
  label,
  size = "md",
  animated = true,
  className,
}: ScoreGaugeProps) {
  const [displayScore, setDisplayScore] = useState(animated ? 0 : score);
  const cfg = SIZES[size];
  const circumference = 2 * Math.PI * cfg.r;
  const offset = circumference - (displayScore / 100) * circumference;
  const color = scoreToColor(score);
  const trailColor = scoreToTrailColor(score);
  const grade = scoreToGrade(score);
  const svgSize = (cfg.r + cfg.stroke) * 2;

  useEffect(() => {
    if (!animated) {
      setDisplayScore(score);
      return;
    }
    let frame: number;
    let start: number | null = null;
    const duration = 1200; // ms

    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      // Ease out cubic
      const eased = 1 - (1 - progress) ** 3;
      setDisplayScore(Math.round(eased * score));
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score, animated]);

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="relative" style={{ width: svgSize, height: svgSize }}>
        <svg
          width={svgSize}
          height={svgSize}
          className="-rotate-90"
          aria-hidden="true"
        >
          {/* Trail */}
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={cfg.r}
            fill="none"
            stroke={trailColor}
            strokeWidth={cfg.stroke}
          />
          {/* Active arc */}
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={cfg.r}
            fill="none"
            stroke={color}
            strokeWidth={cfg.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-300"
            style={{
              filter: `drop-shadow(0 0 6px ${color})`,
            }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn("font-bold tabular-nums tracking-tight", cfg.textSize)}
            style={{ color }}
          >
            {displayScore}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wider",
              cfg.gradeSize,
            )}
            style={{
              backgroundColor: `${color}20`,
              color,
            }}
          >
            {grade}
          </span>
        </div>
      </div>
      <span className={cn("text-center font-medium text-muted-foreground", cfg.labelSize)}>
        {label}
      </span>
    </div>
  );
}
