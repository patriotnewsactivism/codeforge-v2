/**
 * ErrorIngestionPanel.tsx — Live Error Ingestion
 * Shows production incidents, auto-fix status, and lets users trigger manual analysis.
 */
import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, CheckCircle2, Loader2, Zap, Clock,
  GitPullRequest, XCircle, RefreshCw, Plus, X
} from "lucide-react";
import { toast } from "sonner";

type Incident = {
  _id: Id<"errorIncidents">;
  _creationTime: number;
  source: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  affectedFile?: string;
  environment?: string;
  occurrenceCount: number;
  status: string;
  prUrl?: string;
  fixSummary?: string;
  fingerprint: string;
  createdAt: number;
  lastSeenAt: number;
  autoFixAttempted: boolean;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  new:       { label: "New",       color: "bg-red-500/20 text-red-400 border-red-500/30",     icon: <AlertTriangle className="h-3 w-3" /> },
  analyzing: { label: "Analyzing", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  fixing:    { label: "Fixing",    color: "bg-blue-500/20 text-blue-400 border-blue-500/30",   icon: <Zap className="h-3 w-3" /> },
  pr_opened: { label: "PR Open",   color: "bg-violet-500/20 text-violet-400 border-violet-500/30", icon: <GitPullRequest className="h-3 w-3" /> },
  resolved:  { label: "Resolved",  color: "bg-green-500/20 text-green-400 border-green-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
  wont_fix:  { label: "Won't Fix", color: "bg-muted text-muted-foreground border-border",      icon: <XCircle className="h-3 w-3" /> },
};

const SOURCE_COLORS: Record<string, string> = {
  sentry:     "text-orange-400",
  datadog:    "text-purple-400",
  bugsnag:    "text-blue-400",
  cloudwatch: "text-yellow-400",
  webhook:    "text-cyan-400",
  manual:     "text-muted-foreground",
};

function IncidentCard({
  incident,
  projectId,
  repoFullName,
}: {
  incident: Incident;
  projectId: Id<"projects">;
  repoFullName?: string;
}) {
  const [fixing, setFixing] = useState(false);
  const autoFix = useAction(api.errorIngestion.autoFix);
  const markWontFix = useMutation(api.errorIngestion.updateIncidentStatus);

  const statusCfg = STATUS_CONFIG[incident.status] ?? STATUS_CONFIG.new!;
  const canFix = ["new", "analyzing"].includes(incident.status) && !incident.autoFixAttempted;

  const handleAutoFix = async () => {
    setFixing(true);
    try {
      const result = await autoFix({
        projectId,
        incidentId: incident._id,
        repoFullName,
      });
      if (result.success) {
        toast.success(result.prUrl ? `PR opened: ${result.prUrl}` : "Fix applied");
      } else {
        toast.error(result.error ?? "Auto-fix failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setFixing(false);
    }
  };

  const handleWontFix = async () => {
    try {
      await markWontFix({ incidentId: incident._id, status: "wont_fix" });
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-card hover:border-primary/30 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase ${SOURCE_COLORS[incident.source] ?? ""}`}>
              {incident.source}
            </span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 flex items-center gap-1 ${statusCfg.color}`}>
              {statusCfg.icon}
              {statusCfg.label}
            </Badge>
            {incident.occurrenceCount > 1 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                ×{incident.occurrenceCount}
              </Badge>
            )}
            {incident.environment && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                {incident.environment}
              </Badge>
            )}
          </div>
          <p className="text-xs font-semibold text-foreground mt-1 line-clamp-1">{incident.errorType}</p>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{incident.errorMessage}</p>
        </div>
      </div>

      {/* Affected file */}
      {incident.affectedFile && (
        <p className="text-[10px] text-muted-foreground font-mono mb-2 truncate">
          📄 {incident.affectedFile}
        </p>
      )}

      {/* Fix summary */}
      {incident.fixSummary && (
        <div className="bg-green-950/30 border border-green-500/20 rounded p-2 mb-2">
          <p className="text-[10px] text-green-400 leading-relaxed">{incident.fixSummary}</p>
        </div>
      )}

      {/* PR link */}
      {incident.prUrl && (
        <a
          href={incident.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 mb-2"
        >
          <GitPullRequest className="h-3 w-3" />
          View Pull Request
        </a>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          {new Date(incident.createdAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-1">
          {incident.status !== "wont_fix" && incident.status !== "resolved" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={handleWontFix}
              title="Mark as won't fix"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
          {canFix && (
            <Button
              size="sm"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={handleAutoFix}
              disabled={fixing}
            >
              {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {fixing ? "Fixing…" : "Auto-Fix"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ErrorIngestionPanelProps {
  projectId: Id<"projects">;
  repoFullName?: string;
}

export function ErrorIngestionPanel({ projectId, repoFullName }: ErrorIngestionPanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const [showManual, setShowManual] = useState(false);
  const [manualError, setManualError] = useState({ type: "", message: "", file: "" });
  const [submitting, setSubmitting] = useState(false);

  const recordIncident = useMutation(api.errorIngestion.recordIncident);
  const autoFix = useAction(api.errorIngestion.autoFix);

  const incidents = useQuery(api.errorIngestion.listIncidents, {
    projectId,
    limit: 50,
  }) as Incident[] | undefined;

  const filtered = incidents?.filter((i) =>
    filter === "all" ? true : i.status === filter
  ) ?? [];

  const statusCounts = incidents?.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  const handleManualSubmit = async () => {
    if (!manualError.type || !manualError.message) return;
    setSubmitting(true);
    try {
      const fingerprint = `manual-${manualError.type}-${Date.now()}`;
      const incidentId = await recordIncident({
        projectId,
        source: "manual",
        errorType: manualError.type,
        errorMessage: manualError.message,
        affectedFile: manualError.file || undefined,
        occurrenceCount: 1,
        fingerprint,
      });
      toast.success("Incident recorded — triggering auto-fix…");
      setShowManual(false);
      setManualError({ type: "", message: "", file: "" });
      await autoFix({ projectId, incidentId, repoFullName });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[oklch(0.10_0.02_260)] shrink-0">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <span className="text-xs font-semibold text-foreground">Error Ingestion</span>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {incidents?.length ?? 0} incidents
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2 gap-1"
            onClick={() => setShowManual((p) => !p)}
          >
            <Plus className="h-3 w-3" />
            Manual
          </Button>
        </div>
      </div>

      {/* Webhook hint */}
      <div className="px-3 py-1.5 border-b border-border bg-muted/10 text-[10px] text-muted-foreground shrink-0">
        Webhook endpoint: <code className="font-mono text-cyan-400">/api/error-ingest?projectId={projectId}</code>
      </div>

      {/* Manual incident form */}
      {showManual && (
        <div className="px-3 py-2 border-b border-border bg-card shrink-0 space-y-2">
          <p className="text-[10px] font-semibold text-foreground">Submit manual incident</p>
          <Input
            className="h-7 text-xs"
            placeholder="Error type (e.g. TypeError)"
            value={manualError.type}
            onChange={(e) => setManualError((p) => ({ ...p, type: e.target.value }))}
          />
          <Input
            className="h-7 text-xs"
            placeholder="Error message"
            value={manualError.message}
            onChange={(e) => setManualError((p) => ({ ...p, message: e.target.value }))}
          />
          <Input
            className="h-7 text-xs"
            placeholder="Affected file (optional)"
            value={manualError.file}
            onChange={(e) => setManualError((p) => ({ ...p, file: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-6 text-[10px] flex-1 gap-1"
              onClick={handleManualSubmit}
              disabled={submitting || !manualError.type || !manualError.message}
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {submitting ? "Submitting…" : "Submit & Auto-Fix"}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowManual(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-border shrink-0 overflow-x-auto scrollbar-none">
        {[
          { key: "all", label: `All (${incidents?.length ?? 0})` },
          { key: "new", label: `New (${statusCounts.new ?? 0})` },
          { key: "analyzing", label: `Analyzing (${statusCounts.analyzing ?? 0})` },
          { key: "fixing", label: `Fixing (${statusCounts.fixing ?? 0})` },
          { key: "pr_opened", label: `PR (${statusCounts.pr_opened ?? 0})` },
          { key: "resolved", label: `Resolved (${statusCounts.resolved ?? 0})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`shrink-0 text-[10px] px-2 py-0.5 rounded transition-colors ${
              filter === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Incident list */}
      <ScrollArea className="flex-1 px-3 py-2">
        {!incidents ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500/40 mb-3" />
            <p className="text-muted-foreground text-xs">
              {filter === "all" ? "No incidents yet. Connect your error tracker via webhook." : `No ${filter} incidents.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((incident) => (
              <IncidentCard
                key={incident._id}
                incident={incident}
                projectId={projectId}
                repoFullName={repoFullName}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Stats footer */}
      {incidents && incidents.length > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 bg-[oklch(0.10_0.02_260)]">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
              {statusCounts.resolved ?? 0} resolved
            </span>
            <span className="flex items-center gap-1">
              <GitPullRequest className="h-2.5 w-2.5 text-violet-400" />
              {statusCounts.pr_opened ?? 0} PRs opened
            </span>
            <span className="ml-auto">
              Auto-fix rate: {incidents.length ? Math.round(((statusCounts.resolved ?? 0) + (statusCounts.pr_opened ?? 0)) / incidents.length * 100) : 0}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
