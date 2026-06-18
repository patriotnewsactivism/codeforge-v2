/**
 * DIFF VIEWER — Side-by-side diff panel (inline in IDE tab)
 * Shows diffs from agent runs. User can browse changed files and accept/reject.
 */

import { useMutation, useQuery } from "convex/react";
import {
  ChevronLeft,
  ChevronRight,
  File,
  GitCompareArrows,
  Undo2,
  Check,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type ChangeHistoryDoc = Doc<"changeHistory">;

interface DiffLine {
  type: "add" | "remove" | "unchanged";
  content: string;
  lineNum: number;
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const lines: DiffLine[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);
  let lineNum = 1;
  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i];
    const m = modLines[i];
    if (o === undefined) {
      lines.push({ type: "add", content: m, lineNum: lineNum++ });
    } else if (m === undefined) {
      lines.push({ type: "remove", content: o, lineNum: lineNum++ });
    } else if (o !== m) {
      lines.push({ type: "remove", content: o, lineNum: lineNum });
      lines.push({ type: "add", content: m, lineNum: lineNum++ });
    } else {
      lines.push({ type: "unchanged", content: o, lineNum: lineNum++ });
    }
  }
  return lines;
}

interface DiffViewerProps {
  projectId: Id<"projects"> | null;
}

export function DiffViewer({ projectId }: DiffViewerProps) {
  const files = useQuery(
    api.files.listByProject,
    projectId ? { projectId } : "skip",
  );
  const changeHistory = useQuery(
    api.changeHistory.listByProject,
    projectId ? { projectId, limit: 50 } : "skip",
  );
  const undoChange = useMutation(api.changeHistory.undoChange);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [comparisonMode, setComparisonMode] = useState<"step" | "cumulative">("step");

  const selectedChange =
    changeHistory &&
    changeHistory.length > 0 &&
    historyIndex < changeHistory.length
      ? changeHistory[historyIndex]
      : null;

  const currentTargetPath = selectedChange?.filePath ?? selectedFile;
  const currentFile = files?.find(
    (f: NonNullable<typeof files>[number]) => f.path === currentTargetPath,
  );
  const content = currentFile?.content ?? "";

  const diffLines = useMemo(() => {
    if (comparisonMode === "cumulative" && currentTargetPath) {
      // Find the OLDEST change for this file to get the "original" content
      const historyForFile = changeHistory?.filter((c: any) => c.filePath === currentTargetPath) ?? [];
      const oldest = historyForFile[historyForFile.length - 1];
      const original = oldest?.previousContent ?? "";
      return computeDiff(original, content);
    }

    if (!selectedChange) {
      return selectedFile && content ? computeDiff("", content) : [];
    }
    return computeDiff(
      selectedChange.previousContent,
      selectedChange.newContent,
    );
  }, [selectedChange, selectedFile, content, comparisonMode, changeHistory, currentTargetPath]);

  const addedCount = diffLines.filter(l => l.type === "add").length;
  const removedCount = diffLines.filter(l => l.type === "remove").length;

  const historyFilePaths = useMemo(() => {
    if (!changeHistory) return [];
    const seen = new Set<string>();
    return changeHistory.filter((c: ChangeHistoryDoc) => {
      if (seen.has(c.filePath)) return false;
      seen.add(c.filePath);
      return true;
    });
  }, [changeHistory]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">
          Select a project to view diffs
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 bg-white/[0.02] shrink-0">
        <GitCompareArrows className="h-4 w-4 text-rose-400/60" />
        <span className="text-xs font-semibold text-white/70 flex-1">
          Diff Viewer
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            disabled={historyIndex <= 0}
            onClick={() => setHistoryIndex(i => i - 1)}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-white/40 tabular-nums min-w-[3ch] text-center">
            {changeHistory && changeHistory.length > 0 ? historyIndex + 1 : 0}/
            {changeHistory?.length ?? 0}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            disabled={
              !changeHistory || historyIndex >= changeHistory.length - 1
            }
            onClick={() => setHistoryIndex(i => i + 1)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          {selectedChange && !selectedChange.undone && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-amber-400"
              onClick={async () => {
                try {
                  await undoChange({ changeId: selectedChange._id });
                  toast.success("Change rejected and reverted");
                } catch (e) {
                  toast.error("Rejection failed");
                }
              }}
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Reject
            </Button>
          )}
          {selectedChange && !selectedChange.undone && (
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[10px] bg-green-500/20 text-green-400 hover:bg-green-500/30"
              onClick={() => {
                toast.success("Change accepted");
                // Optionally move to next change
                if (historyIndex > 0) {
                  setHistoryIndex(i => i - 1);
                }
              }}
            >
              <Check className="h-3 w-3 mr-1" />
              Accept
            </Button>
          )}
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex border-b border-white/5 bg-white/[0.01]">
        <button
          type="button"
          onClick={() => setComparisonMode("step")}
          className={cn(
            "flex-1 px-3 py-1.5 text-[10px] font-medium transition-colors",
            comparisonMode === "step"
              ? "text-rose-400 bg-rose-400/5 border-b border-rose-400"
              : "text-white/30 hover:text-white/50",
          )}
        >
          Step-by-Step
        </button>
        <button
          type="button"
          onClick={() => setComparisonMode("cumulative")}
          className={cn(
            "flex-1 px-3 py-1.5 text-[10px] font-medium transition-colors",
            comparisonMode === "cumulative"
              ? "text-rose-400 bg-rose-400/5 border-b border-rose-400"
              : "text-white/30 hover:text-white/50",
          )}
        >
          Current vs Original
        </button>
      </div>

      {/* File selector */}
      <div className="border-b border-white/5 px-3 py-2 shrink-0">
        <div className="flex gap-1 flex-wrap">
          {historyFilePaths.slice(0, 12).map((c: ChangeHistoryDoc) => {
            const name = c.filePath.split("/").pop() ?? c.filePath;
            return (
              <button
                key={c.filePath}
                type="button"
                onClick={() => {
                  setSelectedFile(c.filePath);
                  const idx = changeHistory?.findIndex(
                    (h: ChangeHistoryDoc) => h.filePath === c.filePath,
                  );
                  if (idx !== undefined && idx >= 0) setHistoryIndex(idx);
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                  selectedChange?.filePath === c.filePath
                    ? "bg-rose-500/20 text-rose-300"
                    : "bg-white/5 text-white/30 hover:text-white/60",
                )}
              >
                <File className="h-2.5 w-2.5" />
                {name}
              </button>
            );
          })}
          {historyFilePaths.length === 0 && (
            <span className="text-[10px] text-white/20">No changes yet</span>
          )}
        </div>
      </div>

      {/* Stats + metadata */}
      {selectedChange && (
        <>
          <div className="flex gap-3 px-3 py-1.5 border-b border-white/5 text-[10px] shrink-0">
            <span className="text-green-400">+{addedCount} added</span>
            <span className="text-red-400">-{removedCount} removed</span>
            <span className="text-white/20">{selectedChange.filePath}</span>
          </div>
          <div className="flex gap-2 px-3 py-1 border-b border-white/5 text-[9px] text-white/30 shrink-0">
            <span>Action: {selectedChange.action}</span>
            {selectedChange.undone && (
              <Badge className="text-[8px] h-3.5 px-1 bg-amber-500/10 text-amber-400 border-0">
                Reverted
              </Badge>
            )}
          </div>
        </>
      )}

      {/* Diff content */}
      <ScrollArea className="flex-1">
        {!changeHistory || changeHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-[11px] text-white/20">No change history yet</p>
            <p className="text-[9px] text-white/10">
              Changes from agent runs and suggestions appear here
            </p>
          </div>
        ) : !selectedChange ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-[11px] text-white/20">
              Select a change to view diff
            </p>
          </div>
        ) : (
          <div className="font-mono text-[11px]">
            {diffLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "flex px-3 py-0 leading-5 min-h-[20px]",
                  line.type === "add" && "bg-green-500/10 text-green-300",
                  line.type === "remove" && "bg-red-500/10 text-red-300",
                  line.type === "unchanged" && "text-white/30",
                )}
              >
                <span className="w-6 shrink-0 text-white/20 select-none">
                  {line.lineNum}
                </span>
                <span className="w-4 shrink-0 select-none">
                  {line.type === "add"
                    ? "+"
                    : line.type === "remove"
                      ? "-"
                      : " "}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all">
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
