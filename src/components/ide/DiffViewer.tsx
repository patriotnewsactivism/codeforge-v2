/**
 * ═══════════════════════════════════════════════════════════════════
 * CODEFORGE v2 — DIFF VIEWER
 * ═══════════════════════════════════════════════════════════════════
 *
 * Side-by-side or unified diff view between two versions of a file.
 * Used for reviewing agent changes before accepting them.
 */
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  GitCompareArrows,
  ArrowLeftRight,
  AlignJustify,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  fileName: string;
  onAccept?: () => void;
  onReject?: () => void;
}

interface DiffLine {
  type: "add" | "remove" | "unchanged";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

// Simple line-by-line diff
function computeDiff(original: string, modified: string): DiffLine[] {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to get diff
  const diff: DiffLine[] = [];
  let i = m;
  let j = n;
  let oldLine = m;
  let newLine = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({
        type: "unchanged",
        content: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({
        type: "add",
        content: newLines[j - 1],
        oldLineNumber: null,
        newLineNumber: j,
      });
      j--;
    } else if (i > 0) {
      diff.unshift({
        type: "remove",
        content: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: null,
      });
      i--;
    }
  }

  return diff;
}

export function DiffViewer({
  originalContent,
  modifiedContent,
  fileName,
  onAccept,
  onReject,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const diffLines = useMemo(
    () => computeDiff(originalContent, modifiedContent),
    [originalContent, modifiedContent]
  );

  const addCount = diffLines.filter((l) => l.type === "add").length;
  const removeCount = diffLines.filter((l) => l.type === "remove").length;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-[#0d0d14]">
        <GitCompareArrows className="h-3.5 w-3.5 text-emerald-400/60" />
        <span className="text-xs font-medium text-white/50 truncate">
          {fileName}
        </span>
        <span className="text-[9px] text-emerald-400/60">+{addCount}</span>
        <span className="text-[9px] text-red-400/60">-{removeCount}</span>
        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center border border-white/10 rounded">
          <button
            onClick={() => setViewMode("unified")}
            className={cn(
              "h-5 px-1.5 text-[9px]",
              viewMode === "unified"
                ? "bg-white/10 text-white/60"
                : "text-white/20"
            )}
          >
            <AlignJustify className="h-3 w-3" />
          </button>
          <button
            onClick={() => setViewMode("split")}
            className={cn(
              "h-5 px-1.5 text-[9px]",
              viewMode === "split"
                ? "bg-white/10 text-white/60"
                : "text-white/20"
            )}
          >
            <ArrowLeftRight className="h-3 w-3" />
          </button>
        </div>

        {/* Actions */}
        {onAccept && (
          <Button
            size="sm"
            className="h-5 text-[9px] px-2 gap-1 bg-emerald-600 hover:bg-emerald-500"
            onClick={onAccept}
          >
            <Check className="h-2.5 w-2.5" /> Accept
          </Button>
        )}
        {onReject && (
          <Button
            size="sm"
            variant="outline"
            className="h-5 text-[9px] px-2 gap-1 text-red-400"
            onClick={onReject}
          >
            <X className="h-2.5 w-2.5" /> Reject
          </Button>
        )}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto font-mono text-[11px]">
        {viewMode === "unified" ? (
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    line.type === "add" && "bg-emerald-500/5",
                    line.type === "remove" && "bg-red-500/5"
                  )}
                >
                  <td className="w-10 px-2 text-right text-white/10 select-none border-r border-white/5">
                    {line.oldLineNumber || ""}
                  </td>
                  <td className="w-10 px-2 text-right text-white/10 select-none border-r border-white/5">
                    {line.newLineNumber || ""}
                  </td>
                  <td className="w-4 px-1 text-center select-none">
                    <span
                      className={cn(
                        "text-[10px]",
                        line.type === "add" && "text-emerald-400/60",
                        line.type === "remove" && "text-red-400/60"
                      )}
                    >
                      {line.type === "add"
                        ? "+"
                        : line.type === "remove"
                        ? "-"
                        : " "}
                    </span>
                  </td>
                  <td className="px-2 whitespace-pre">
                    <span
                      className={cn(
                        line.type === "add" && "text-emerald-400/70",
                        line.type === "remove" && "text-red-400/70",
                        line.type === "unchanged" && "text-white/30"
                      )}
                    >
                      {line.content}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full">
            {/* Old file */}
            <div className="flex-1 border-r border-white/5 overflow-auto">
              {diffLines
                .filter((l) => l.type !== "add")
                .map((line, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex",
                      line.type === "remove" && "bg-red-500/5"
                    )}
                  >
                    <span className="w-10 px-2 text-right text-white/10 shrink-0 select-none">
                      {line.oldLineNumber || ""}
                    </span>
                    <span
                      className={cn(
                        "px-2 whitespace-pre",
                        line.type === "remove"
                          ? "text-red-400/70"
                          : "text-white/30"
                      )}
                    >
                      {line.content}
                    </span>
                  </div>
                ))}
            </div>
            {/* New file */}
            <div className="flex-1 overflow-auto">
              {diffLines
                .filter((l) => l.type !== "remove")
                .map((line, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex",
                      line.type === "add" && "bg-emerald-500/5"
                    )}
                  >
                    <span className="w-10 px-2 text-right text-white/10 shrink-0 select-none">
                      {line.newLineNumber || ""}
                    </span>
                    <span
                      className={cn(
                        "px-2 whitespace-pre",
                        line.type === "add"
                          ? "text-emerald-400/70"
                          : "text-white/30"
                      )}
                    >
                      {line.content}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
