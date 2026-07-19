/**
 * SmartPreview — picks the right runtime for a project and renders it.
 *
 *   static → the existing lightweight iframe (vanilla HTML/CSS/JS, $0)
 *   node   → WebContainers: real npm install + dev server in the browser
 *   server → placeholder for the Phase-2 server-side sandbox (Python/Go/Docker)
 *
 * Drop-in compatible with <LivePreview> (same props), so the IDE can swap to it
 * without other changes.
 */

import { Loader2, Lock, RefreshCw, ServerCog, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  detectProjectKind,
  type RuntimeFile,
  type RuntimeStatus,
} from "@/lib/runtime/types";
import { WebContainerRuntime } from "@/lib/runtime/webcontainer";
import { cn } from "@/lib/utils";
import type { Doc } from "../../../convex/_generated/dataModel";
import { LivePreview } from "./LivePreview";
import { InteractiveTerminal } from "./InteractiveTerminal";

interface SmartPreviewProps {
  files: Doc<"files">[];
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}

export function SmartPreview({
  files,
  autoRefresh,
  onToggleAutoRefresh,
}: SmartPreviewProps) {
  const kind = useMemo(() => detectProjectKind(files), [files]);

  if (kind === "node") {
    return (
      <WebContainerPreview 
        files={files} 
        autoRefresh={autoRefresh} 
        onToggleAutoRefresh={onToggleAutoRefresh} 
      />
    );
  }
  if (kind === "server") {
    return <ServerSandboxPlaceholder />;
  }
  return (
    <LivePreview
      files={files}
      autoRefresh={autoRefresh}
      onToggleAutoRefresh={onToggleAutoRefresh}
    />
  );
}

const PHASE_LABEL: Record<RuntimeStatus["phase"], string> = {
  idle: "Idle",
  booting: "Booting sandbox",
  installing: "Installing dependencies",
  starting: "Starting dev server",
  ready: "Live",
  error: "Error",
};

function WebContainerPreview({ 
  files, 
  autoRefresh, 
  onToggleAutoRefresh 
}: { 
  files: Doc<"files">[];
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}) {
  // WebContainers needs a cross-origin-isolated document.
  // If headers are missing, gracefully degrade to static preview.
  const isolated =
    typeof window !== "undefined" && window.crossOriginIsolated;
    
  if (!isolated) {
    return (
      <div className="flex flex-col h-full relative">
        <div className="absolute top-10 left-0 right-0 z-10 flex justify-center pointer-events-none">
          <div className="bg-yellow-500/20 text-yellow-500/80 border border-yellow-500/30 text-[10px] px-2 py-1 rounded-full backdrop-blur-md">
            Node sandbox disabled (missing COOP/COEP headers). Running in static mode.
          </div>
        </div>
        <LivePreview
          files={files}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={onToggleAutoRefresh}
        />
      </div>
    );
  }
  return <WebContainerPreviewInner files={files} />;
}

function WebContainerPreviewInner({ files }: { files: Doc<"files">[] }) {
  const [status, setStatus] = useState<RuntimeStatus>({ phase: "idle" });
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [panelTab, setPanelTab] = useState<"logs" | "terminal">("logs");
  const [reloadKey, setReloadKey] = useState(0);
  const runtimeRef = useRef<WebContainerRuntime | null>(null);

  // Stable snapshot of file contents — only re-run when content actually changes.
  const runtimeFiles: RuntimeFile[] = useMemo(
    () =>
      files
        .filter(f => !f.isDirectory)
        .map(f => ({ path: f.path, content: f.content })),
    [files],
  );

  // Boot once; push subsequent edits in via updateFiles (hot reload).
  // biome-ignore lint/correctness/useExhaustiveDependencies: boot only on mount
  useEffect(() => {
    const runtime = new WebContainerRuntime();
    runtimeRef.current = runtime;
    void runtime.start(runtimeFiles, {
      onLog: line => setLogs(prev => [...prev.slice(-400), line]),
      onStatus: setStatus,
    });
    return () => {
      void runtime.teardown();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    void runtimeRef.current?.updateFiles(runtimeFiles);
  }, [runtimeFiles]);

  const isError = status.phase === "error";
  const isReady = status.phase === "ready";

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live App
          </span>
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1",
              isReady
                ? "bg-green-500/15 text-green-400"
                : isError
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/15 text-primary",
            )}
          >
            {!isReady && !isError && (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            )}
            {PHASE_LABEL[status.phase]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isReady && status.url && (
            <button
              type="button"
              className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded"
              onClick={() => setReloadKey(k => k + 1)}
              title="Reload preview"
            >
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <button
            type="button"
            className="p-1 hover:bg-[oklch(0.20_0.02_260)] rounded relative"
            onClick={() => setShowLogs(s => !s)}
            title="Toggle build logs"
          >
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            {isError && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Preview surface */}
      <div className="flex-1 relative">
        {isReady && status.url ? (
          <iframe
            key={reloadKey}
            src={status.url}
            className="absolute inset-0 w-full h-full bg-white"
            title="Live App Preview"
            allow="cross-origin-isolated"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center max-w-sm">
              {isError ? (
                <>
                  <p className="text-sm text-destructive mb-2">
                    Couldn't start the app
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status.message}
                  </p>
                  <button
                    type="button"
                    className="mt-3 text-xs text-primary hover:underline"
                    onClick={() => setShowLogs(true)}
                  >
                    View build logs
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
                  <p className="text-sm text-foreground/80">
                    {PHASE_LABEL[status.phase]}…
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status.message ??
                      "Building your app in a real Node sandbox"}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Build logs / interactive terminal */}
      {showLogs && (
        <div className="border-t border-border bg-[oklch(0.09_0.02_260)]">
          <div className="flex items-center justify-between px-3 py-1 border-b border-border">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPanelTab("logs")}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider",
                  panelTab === "logs"
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
                )}
              >
                <Terminal className="h-3 w-3" />
                Build Logs
              </button>
              <button
                type="button"
                onClick={() => setPanelTab("terminal")}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider",
                  panelTab === "terminal"
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
                )}
              >
                <Terminal className="h-3 w-3" />
                Terminal
              </button>
            </div>
            <button
              type="button"
              className="p-0.5 hover:bg-[oklch(0.16_0.02_260)] rounded"
              onClick={() => setShowLogs(false)}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
          {panelTab === "logs" ? (
            <div className="max-h-40 overflow-y-auto font-mono text-[11px] p-2 whitespace-pre-wrap text-foreground/70 leading-relaxed">
              {logs.length === 0 ? (
                <div className="text-muted-foreground/40 text-center py-2">
                  Waiting for output…
                </div>
              ) : (
                logs.join("")
              )}
            </div>
          ) : (
            <div className="h-40">
              <InteractiveTerminal active={panelTab === "terminal"} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServerSandboxPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center bg-[oklch(0.11_0.02_260)] p-6">
      <div className="text-center max-w-sm">
        <div className="mx-auto size-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <ServerCog className="size-6 text-primary" />
        </div>
        <h3 className="font-semibold text-sm mb-1">Needs the server sandbox</h3>
        <p className="text-xs text-muted-foreground">
          This project uses a non-Node toolchain (Python, Go, Rust, or Docker).
          The full server-side sandbox runs these in a real Linux container.
        </p>
        <span className="mt-3 inline-flex items-center gap-1 text-[10px] text-primary/80">
          <Lock className="size-3" />
          Coming soon
        </span>
      </div>
    </div>
  );
}
