import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Lightbulb,
  Sparkles,
  Play,
  X,
  RefreshCw,
  Loader2,
  Check,
  ChevronRight,
  Zap,
  Shield,
  Palette,
  Settings2,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const CATEGORY_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  ui: { icon: Palette, color: "text-pink-400", label: "UI" },
  functionality: { icon: Settings2, color: "text-blue-400", label: "Feature" },
  performance: { icon: TrendingUp, color: "text-green-400", label: "Perf" },
  ux: { icon: Zap, color: "text-amber-400", label: "UX" },
  security: { icon: Shield, color: "text-red-400", label: "Security" },
};

const PRIORITY_COLORS = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

interface SuggestionsPanelProps {
  projectId: Id<"projects">;
  onImplement: (prompt: string, suggestionId: Id<"suggestions">) => void;
}

export function SuggestionsPanel({ projectId, onImplement }: SuggestionsPanelProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const suggestions = useQuery(api.suggestions.listByProject, { projectId });
  const generateSuggestions = useAction(api.suggestions.generateSuggestions);
  const updateStatus = useMutation(api.suggestions.updateStatus);

  const pendingSuggestions =
    suggestions?.filter((s) => s.status === "pending") ?? [];
  const implementingSuggestions =
    suggestions?.filter((s) => s.status === "implementing") ?? [];
  const doneSuggestions =
    suggestions?.filter((s) => s.status === "done") ?? [];

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await generateSuggestions({ projectId });
    } catch (e) {
      console.error("Failed to generate suggestions:", e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDismiss = (suggestionId: Id<"suggestions">) => {
    updateStatus({ suggestionId, status: "dismissed" });
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suggestions
          </span>
          {pendingSuggestions.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
              {pendingSuggestions.length}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isGenerating ? "Analyzing..." : "Generate"}
        </Button>
      </div>

      {/* Suggestions list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {(!suggestions || suggestions.length === 0) && !isGenerating && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Sparkles className="h-8 w-8 text-amber-400/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              No suggestions yet
            </p>
            <p className="text-xs text-muted-foreground/60 mb-3">
              Click Generate to have AI analyze your project and suggest features
            </p>
            <Button size="sm" onClick={handleGenerate} className="gap-1">
              <Sparkles className="h-3 w-3" />
              Generate Suggestions
            </Button>
          </div>
        )}

        {isGenerating && pendingSuggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-primary animate-spin mb-3" />
            <p className="text-xs text-muted-foreground">
              AI is analyzing your project...
            </p>
          </div>
        )}

        {/* Implementing */}
        {implementingSuggestions.map((s) => (
          <SuggestionCard
            key={s._id}
            suggestion={s}
            isExpanded={expandedId === s._id}
            onToggle={() =>
              setExpandedId(expandedId === s._id ? null : s._id)
            }
            isImplementing
          />
        ))}

        {/* Pending */}
        {pendingSuggestions.map((s) => (
          <SuggestionCard
            key={s._id}
            suggestion={s}
            isExpanded={expandedId === s._id}
            onToggle={() =>
              setExpandedId(expandedId === s._id ? null : s._id)
            }
            onImplement={() =>
              onImplement(s.implementationPrompt, s._id)
            }
            onDismiss={() => handleDismiss(s._id)}
          />
        ))}

        {/* Done */}
        {doneSuggestions.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/40 px-1 pt-2">
              Completed
            </div>
            {doneSuggestions.map((s) => (
              <SuggestionCard
                key={s._id}
                suggestion={s}
                isExpanded={expandedId === s._id}
                onToggle={() =>
                  setExpandedId(expandedId === s._id ? null : s._id)
                }
                isDone
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: {
    _id: string;
    title: string;
    description: string;
    category: string;
    priority: "high" | "medium" | "low";
    status: string;
  };
  isExpanded: boolean;
  onToggle: () => void;
  onImplement?: () => void;
  onDismiss?: () => void;
  isImplementing?: boolean;
  isDone?: boolean;
}

function SuggestionCard({
  suggestion,
  isExpanded,
  onToggle,
  onImplement,
  onDismiss,
  isImplementing,
  isDone,
}: SuggestionCardProps) {
  const catConfig = CATEGORY_CONFIG[suggestion.category] ?? CATEGORY_CONFIG.functionality;
  const CatIcon = catConfig.icon;

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        isDone
          ? "border-border/50 opacity-60"
          : isImplementing
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-[oklch(0.14_0.02_260)] hover:border-primary/30"
      )}
    >
      <button
        type="button"
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <CatIcon className={cn("h-3 w-3", catConfig.color)} />
            <span className="text-xs font-medium truncate">
              {suggestion.title}
            </span>
            {isImplementing && (
              <Loader2 className="h-3 w-3 text-primary animate-spin ml-auto shrink-0" />
            )}
            {isDone && (
              <Check className="h-3 w-3 text-green-400 ml-auto shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[9px] px-1 py-0.5 rounded border",
                PRIORITY_COLORS[suggestion.priority]
              )}
            >
              {suggestion.priority}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {catConfig.label}
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground mt-2 mb-3 leading-relaxed">
            {suggestion.description}
          </p>
          {!isDone && !isImplementing && (
            <div className="flex gap-2">
              {onImplement && (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onImplement();
                  }}
                >
                  <Play className="h-3 w-3" />
                  Implement
                </Button>
              )}
              {onDismiss && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
