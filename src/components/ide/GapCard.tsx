import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Flame,
  Loader2,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GapCardProps {
  title: string;
  description: string;
  category: string;
  priority: "critical" | "high" | "medium" | "low";
  impact: number;
  effort: "trivial" | "small" | "medium" | "large" | "epic";
  dimension: string;
  onFix?: () => void;
  fixing?: boolean;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  critical: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
    icon: <Flame className="h-3.5 w-3.5" />,
  },
  high: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  medium: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/30",
    icon: <Zap className="h-3.5 w-3.5" />,
  },
  low: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
    icon: <ArrowUpRight className="h-3.5 w-3.5" />,
  },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: <Shield className="h-4 w-4" />,
  secrets: <Shield className="h-4 w-4" />,
  testing: <Sparkles className="h-4 w-4" />,
  infrastructure: <Zap className="h-4 w-4" />,
  ci: <Zap className="h-4 w-4" />,
  deploy: <Zap className="h-4 w-4" />,
  performance: <Clock className="h-4 w-4" />,
};

const EFFORT_LABELS: Record<string, { label: string; dots: number }> = {
  trivial: { label: "Trivial", dots: 1 },
  small: { label: "Small", dots: 2 },
  medium: { label: "Medium", dots: 3 },
  large: { label: "Large", dots: 4 },
  epic: { label: "Epic", dots: 5 },
};

export function GapCard({
  title,
  description,
  category,
  priority,
  impact,
  effort,
  dimension,
  onFix,
  fixing,
}: GapCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium;
  const effortInfo = EFFORT_LABELS[effort] ?? EFFORT_LABELS.medium;
  const categoryIcon = CATEGORY_ICONS[category] ?? <Sparkles className="h-4 w-4" />;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border p-4 transition-all duration-200",
        style.border,
        isHovered ? "bg-card/80 shadow-lg" : "bg-card/40",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Priority indicator bar */}
      <div
        className={cn("absolute left-0 top-0 h-full w-1 rounded-l-lg", style.bg)}
        style={{
          background: `linear-gradient(to bottom, ${style.text.replace("text-", "").replace("-400", "")}80, transparent)`,
        }}
      />

      <div className="flex items-start gap-3 pl-2">
        {/* Category icon */}
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            style.bg,
            style.text,
          )}
        >
          {categoryIcon}
        </div>

        <div className="min-w-0 flex-1">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground leading-tight">
              {title}
            </h4>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                style.bg,
                style.text,
              )}
            >
              {style.icon}
              {priority}
            </span>
          </div>

          {/* Description */}
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>

          {/* Metadata row */}
          <div className="mt-2.5 flex items-center gap-3 text-[10px] text-muted-foreground">
            {/* Impact */}
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground/70">Impact</span>
              <span className={cn("font-bold tabular-nums", style.text)}>
                +{impact}
              </span>
            </span>

            <span className="text-border">•</span>

            {/* Effort dots */}
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground/70">Effort</span>
              <span className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      i < effortInfo.dots
                        ? "bg-foreground/50"
                        : "bg-foreground/10",
                    )}
                  />
                ))}
              </span>
            </span>

            <span className="text-border">•</span>

            {/* Dimension */}
            <span className="capitalize text-foreground/50">{dimension}</span>
          </div>
        </div>

        {/* Fix button */}
        {onFix && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onFix}
            disabled={fixing}
            className={cn(
              "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
              style.text,
              "hover:bg-primary/10",
            )}
          >
            {fixing ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Fixing…
              </>
            ) : (
              <>
                <Sparkles className="mr-1 h-3 w-3" />
                Fix
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
