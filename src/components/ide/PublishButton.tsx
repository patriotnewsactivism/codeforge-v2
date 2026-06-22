/**
 * PublishButton — the one-click "sandbox → live" action.
 *
 * Wraps the existing Vercel deploy flow (convex/deployVercel.ts): kicks off a
 * deployment, polls until the build is READY, then surfaces the live URL. Drop
 * it anywhere a project is in scope (Deploy panel, IDE top bar).
 */

import { useAction } from "convex/react";
import { Check, ExternalLink, Loader2, Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Phase = "idle" | "deploying" | "live" | "error";

export function PublishButton({
  projectId,
  className,
}: {
  projectId: Id<"projects"> | null;
  className?: string;
}) {
  const deploy = useAction(api.deployVercel.deploy);
  const getStatus = useAction(api.deployVercel.getStatus);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLabel, setStatusLabel] = useState<string>("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handlePublish = useCallback(async () => {
    if (!projectId) return;
    setPhase("deploying");
    setStatusLabel("Uploading");
    setLiveUrl(null);
    try {
      const { deploymentId, url } = await deploy({ projectId });
      setLiveUrl(url);
      setStatusLabel("Building");

      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const status = await getStatus({ deploymentId });
          setStatusLabel(prettyState(status.readyState));
          if (status.readyState === "READY") {
            stopPolling();
            setLiveUrl(`https://${status.url}`);
            setPhase("live");
            toast.success("Your app is live!", {
              description: `https://${status.url}`,
            });
          } else if (status.readyState === "ERROR") {
            stopPolling();
            setPhase("error");
            toast.error("Build failed", {
              description: status.error?.message ?? "Check Vercel logs",
            });
          }
        } catch {
          // Transient poll failure — keep trying until READY/ERROR.
        }
      }, 3000);
    } catch (e) {
      setPhase("error");
      const message = e instanceof Error ? e.message : "Unknown error";
      toast.error("Couldn't publish", {
        description: /VERCEL_TOKEN/.test(message)
          ? "Set VERCEL_TOKEN in your Convex environment to publish."
          : message,
      });
    }
  }, [deploy, getStatus, projectId, stopPolling]);

  // Live state: show the URL with quick actions.
  if (phase === "live" && liveUrl) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2",
          className,
        )}
      >
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-xs text-green-300 flex-1 truncate">
          Live · {liveUrl.replace(/^https?:\/\//, "")}
        </span>
        <button
          type="button"
          onClick={() => window.open(liveUrl, "_blank")}
          className="text-green-400 hover:text-green-300"
          title="Open live site"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-green-300/70 hover:text-green-200"
          onClick={() => void handlePublish()}
        >
          Republish
        </Button>
      </div>
    );
  }

  const busy = phase === "deploying";
  return (
    <Button
      onClick={() => void handlePublish()}
      disabled={!projectId || busy}
      className={cn("w-full gap-2", className)}
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {statusLabel || "Publishing"}…
        </>
      ) : (
        <>
          <Rocket className="h-4 w-4" />
          {phase === "error" ? "Retry Publish" : "Publish to Live"}
        </>
      )}
    </Button>
  );
}

function prettyState(readyState: string): string {
  switch (readyState) {
    case "INITIALIZING":
      return "Initializing";
    case "QUEUED":
      return "Queued";
    case "BUILDING":
      return "Building";
    case "READY":
      return "Live";
    case "ERROR":
      return "Failed";
    default:
      return readyState;
  }
}
