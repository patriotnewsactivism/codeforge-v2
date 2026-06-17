/**
 * CinemaPanel.tsx — Live Mission Cinema
 * Scrub through every agent spawn, tool call, thought, debate, and sentry event
 * recorded as cinema frames. Real-time via Convex useQuery.
 */

import { useAction, useQuery } from "convex/react";
import {
  Brain,
  CheckCircle,
  Film,
  GitBranch,
  MessageSquare,
  Pause,
  Play,
  Shield,
  SkipBack,
  SkipForward,
  Swords,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type CinemaFrame = {
  _id: Id<"cinemaFrames">;
  ts: number;
  frameType: string;
  agentId: string;
  agentName: string;
  agentRole?: string;
  parentAgentId?: string;
  spawnDepth?: number;
  payload: string;
  durationMs?: number;
  success?: boolean;
};

const FRAME_ICONS: Record<string, React.ReactNode> = {
  spawn: <GitBranch className="h-3.5 w-3.5 text-cyan-400" />,
  tool_call: <Zap className="h-3.5 w-3.5 text-yellow-400" />,
  tool_result: <Zap className="h-3.5 w-3.5 text-yellow-300" />,
  thought: <Brain className="h-3.5 w-3.5 text-violet-400" />,
  debate: <Swords className="h-3.5 w-3.5 text-orange-400" />,
  sentry: <Shield className="h-3.5 w-3.5 text-red-400" />,
  message: <MessageSquare className="h-3.5 w-3.5 text-blue-400" />,
  memory_read: <Brain className="h-3.5 w-3.5 text-purple-300" />,
  memory_write: <Brain className="h-3.5 w-3.5 text-purple-500" />,
  complete: <CheckCircle className="h-3.5 w-3.5 text-green-400" />,
  error: <XCircle className="h-3.5 w-3.5 text-red-500" />,
};

const FRAME_COLORS: Record<string, string> = {
  spawn: "border-l-cyan-500 bg-cyan-950/20",
  tool_call: "border-l-yellow-500 bg-yellow-950/20",
  tool_result: "border-l-yellow-400 bg-yellow-900/10",
  thought: "border-l-violet-500 bg-violet-950/20",
  debate: "border-l-orange-500 bg-orange-950/20",
  sentry: "border-l-red-500 bg-red-950/20",
  message: "border-l-blue-500 bg-blue-950/20",
  memory_read: "border-l-purple-400 bg-purple-950/10",
  memory_write: "border-l-purple-600 bg-purple-950/20",
  complete: "border-l-green-500 bg-green-950/20",
  error: "border-l-red-600 bg-red-950/30",
};

function FrameCard({
  frame,
  isActive,
}: {
  frame: CinemaFrame;
  isActive: boolean;
}) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(frame.payload);
  } catch {}

  const depth = frame.spawnDepth ?? 0;
  const indent = Math.min(depth * 12, 60);

  return (
    <div
      className={`border-l-2 rounded-r px-3 py-2 text-xs transition-all ${
        FRAME_COLORS[frame.frameType] ?? "border-l-border bg-muted/10"
      } ${isActive ? "ring-1 ring-primary shadow-lg shadow-primary/10" : ""}`}
      style={{ marginLeft: indent }}
    >
      <div className="flex items-center gap-2 mb-1">
        {FRAME_ICONS[frame.frameType]}
        <span className="font-semibold text-foreground truncate">
          {frame.agentName}
        </span>
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
          {frame.frameType}
        </Badge>
        {frame.agentRole && (
          <span className="text-muted-foreground text-[9px] shrink-0">
            {frame.agentRole}
          </span>
        )}
        {frame.durationMs && (
          <span className="ml-auto text-muted-foreground text-[9px] shrink-0">
            {frame.durationMs}ms
          </span>
        )}
        {frame.success === false && (
          <XCircle className="h-3 w-3 text-red-400 shrink-0" />
        )}
        {frame.success === true && (
          <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
        )}
      </div>

      {/* Show relevant payload fields */}
      {Boolean(payload.content) && (
        <p className="text-muted-foreground leading-relaxed line-clamp-2">
          {String(payload.content)}
        </p>
      )}
      {Boolean(payload.tool) && (
        <p className="text-yellow-300/80 font-mono">
          {String(payload.tool)}
          {payload.args ? `(${JSON.stringify(payload.args).slice(0, 80)})` : ""}
        </p>
      )}
      {Boolean(payload.output) && !payload.content && (
        <p className="text-green-300/80 line-clamp-2">
          {String(payload.output).slice(0, 120)}
        </p>
      )}

      <div className="text-[9px] text-muted-foreground/50 mt-1">
        {new Date(frame.ts).toLocaleTimeString()}
      </div>
    </div>
  );
}

interface MissionSummary {
  _id: Id<"buildSessions">;
  _creationTime: number;
  status: string;
  currentStep?: string;
  startedAt: number;
}

interface CinemaPanelProps {
  projectId: Id<"projects">;
  missionId: Id<"buildSessions"> | null;
  missionsList?: MissionSummary[];
  onSelectMission?: (id: Id<"buildSessions">) => void;
}

export function CinemaPanel({
  projectId,
  missionId,
  missionsList = [],
  onSelectMission,
}: CinemaPanelProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const frameRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildCinema = useAction(api.cinema.buildCinemaFromExisting);
  const [building, setBuilding] = useState(false);

  const frames = useQuery(
    api.cinema.getFrames,
    missionId ? { missionId, limit: 500 } : "skip",
  ) as CinemaFrame[] | undefined;

  const summary = useQuery(
    api.cinema.getTimelineSummary,
    missionId ? { missionId } : "skip",
  );

  // Auto-scroll to active frame
  useEffect(() => {
    const el = frameRefs.current.get(currentIndex);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentIndex]);

  // Playback engine
  useEffect(() => {
    if (!isPlaying || !frames?.length) return;
    const baseMs = 300;
    const delay = baseMs / playbackSpeed;
    intervalRef.current = setInterval(() => {
      setCurrentIndex(prev => {
        if (prev >= (frames?.length ?? 1) - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, delay);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, frames?.length]);

  const handleBuildFromExisting = async () => {
    if (!missionId) return;
    setBuilding(true);
    try {
      await buildCinema({ projectId, missionId });
    } finally {
      setBuilding(false);
    }
  };

  if (!missionId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[oklch(0.10_0.02_260)] shrink-0">
          <Film className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Mission Cinema</span>
        </div>
        {missionsList.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center p-6">
            <div>
              <Film className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                No missions yet — run an agent task to generate a Cinema
                recording.
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide">
              Select a mission to replay
            </p>
            <div className="flex flex-col gap-1.5">
              {missionsList.map(m => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => onSelectMission?.(m._id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/50 text-left transition-colors"
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      m.status === "completed"
                        ? "bg-green-400"
                        : m.status === "running"
                          ? "bg-yellow-400 animate-pulse"
                          : m.status === "error"
                            ? "bg-red-400"
                            : "bg-muted"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">
                      {m.currentStep ?? "Mission"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(m.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
                      m.status === "completed"
                        ? "text-green-400 border-green-500/30"
                        : m.status === "running"
                          ? "text-yellow-400 border-yellow-500/30"
                          : m.status === "error"
                            ? "text-red-400 border-red-500/30"
                            : "text-muted-foreground border-border"
                    }`}
                  >
                    {m.status}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  }

  const totalFrames = frames?.length ?? 0;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[oklch(0.10_0.02_260)] shrink-0">
        <Film className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">
          Mission Cinema
        </span>
        {onSelectMission && (
          <button
            type="button"
            onClick={() => onSelectMission(null as any)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← missions
          </button>
        )}
        {summary && (
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{summary.totalFrames} frames</span>
            <span>{summary.agentCount} agents</span>
            <span>depth {summary.peakDepth}</span>
            <span>{Math.round((summary.durationMs ?? 0) / 1000)}s</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      {summary && (
        <div className="flex gap-2 px-3 py-1.5 border-b border-border shrink-0 overflow-x-auto scrollbar-none">
          {Object.entries(summary.byType ?? {}).map(([type, count]) => (
            <div key={type} className="flex items-center gap-1 shrink-0">
              {FRAME_ICONS[type]}
              <span className="text-[10px] text-muted-foreground">{String(count)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Frames */}
      <ScrollArea className="flex-1 px-2 py-2" ref={scrollRef}>
        {!frames || frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Film className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-muted-foreground text-xs text-center">
              No cinema frames recorded for this mission yet.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBuildFromExisting}
              disabled={building}
              className="text-xs"
            >
              {building ? "Building…" : "Backfill from existing data"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {frames.map((frame, i) => (
              <div
                key={frame._id}
                ref={el => {
                  if (el) frameRefs.current.set(i, el);
                }}
                onClick={() => {
                  setCurrentIndex(i);
                  setIsPlaying(false);
                }}
                className="cursor-pointer"
              >
                <FrameCard frame={frame} isActive={i === currentIndex} />
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Playback controls */}
      {totalFrames > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-2 bg-[oklch(0.10_0.02_260)]">
          {/* Scrub bar */}
          <div className="mb-2">
            <Slider
              min={0}
              max={Math.max(0, totalFrames - 1)}
              value={[currentIndex]}
              onValueChange={([v]) => {
                setCurrentIndex(v!);
                setIsPlaying(false);
              }}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
              <span>Frame {currentIndex + 1}</span>
              <span>{totalFrames} total</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setCurrentIndex(0);
                setIsPlaying(false);
              }}
            >
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant={isPlaying ? "default" : "outline"}
              className="h-7 w-7"
              onClick={() => setIsPlaying(p => !p)}
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setCurrentIndex(totalFrames - 1);
                setIsPlaying(false);
              }}
            >
              <SkipForward className="h-3.5 w-3.5" />
            </Button>

            {/* Speed */}
            <div className="ml-auto flex items-center gap-1.5">
              {[0.5, 1, 2, 4].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPlaybackSpeed(s)}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    playbackSpeed === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
