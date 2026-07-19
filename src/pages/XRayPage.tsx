import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Box,
  Code2,
  Database,
  FileCode2,
  Flame,
  FolderTree,
  GitBranch,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  TestTube2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { GapCard } from "@/components/ide/GapCard";
import { ScoreGauge } from "@/components/ide/ScoreGauge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function XRayPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const typedProjectId = projectId as Id<"projects">;

  // Queries
  const project = useQuery(api.projects.get, { projectId: typedProjectId });
  const xray = useQuery(api.xray.getLatestXRay, {
    projectId: typedProjectId,
  });
  const scores = useQuery(api.completionScore.getLatestScores, {
    projectId: typedProjectId,
  });
  const workItemStats = useQuery(api.planner.getWorkItemStats, {
    projectId: typedProjectId,
  });

  // Actions
  const runFullAnalysis = useAction(api.completionScore.runFullAnalysis);
  const generatePlan = useAction(api.planner.generatePlan);
  const startExecution = useAction(api.planner.startAutonomousExecution);

  // State
  const [analyzing, setAnalyzing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);

  // Parse X-Ray data
  const languages = xray?.languages ? JSON.parse(xray.languages) : null;
  const dependencies = xray?.dependencies
    ? JSON.parse(xray.dependencies)
    : null;
  const apis = xray?.apis ? JSON.parse(xray.apis) : null;
  const database = xray?.database ? JSON.parse(xray.database) : null;
  const tests = xray?.tests ? JSON.parse(xray.tests) : null;
  const security = xray?.security ? JSON.parse(xray.security) : null;
  const techDebt = xray?.techDebt ? JSON.parse(xray.techDebt) : null;
  const infrastructure = xray?.infrastructure
    ? JSON.parse(xray.infrastructure)
    : null;
  const fileStats = xray?.fileStats ? JSON.parse(xray.fileStats) : null;

  // Parse scores data
  const findings = scores?.findings ? JSON.parse(scores.findings) : [];
  const gaps = scores?.gapAnalysis ? JSON.parse(scores.gapAnalysis) : [];

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    try {
      await runFullAnalysis({ projectId: typedProjectId });
      toast.success("Analysis complete!");
    } catch (err) {
      toast.error(
        `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGeneratePlan = async () => {
    setPlanning(true);
    try {
      await generatePlan({ projectId: typedProjectId });
      toast.success("Engineering plan generated!");
    } catch (err) {
      toast.error(
        `Plan generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setPlanning(false);
    }
  };

  const handleStartExecution = async () => {
    setExecuting(true);
    try {
      const result = await startExecution({ projectId: typedProjectId });
      toast.success(result);
    } catch (err) {
      toast.error(
        `Execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/50 px-6 py-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/project/${projectId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            IDE
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold">Repository X-Ray</h1>
              <p className="text-[10px] text-muted-foreground">
                {project?.name ?? "Loading..."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRunAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {analyzing ? "Analyzing…" : "Re-analyze"}
          </Button>

          {scores && !workItemStats?.total && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGeneratePlan}
              disabled={planning}
            >
              {planning ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <BarChart3 className="mr-1 h-3.5 w-3.5" />
              )}
              {planning ? "Planning…" : "Generate Plan"}
            </Button>
          )}

          {workItemStats && workItemStats.total > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={handleStartExecution}
              disabled={executing}
              className="bg-gradient-to-r from-primary to-emerald-500 text-primary-foreground shadow-lg shadow-primary/20"
            >
              {executing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              {executing ? "Executing…" : "Complete This Repo"}
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!xray ? (
          /* No analysis yet */
          <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
              <Zap className="h-10 w-10 text-primary" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold">Repository X-Ray</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Scan this repository to create a digital twin — comprehensive
                analysis of structure, dependencies, security, and
                production-readiness.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              onClick={handleRunAnalysis}
              disabled={analyzing}
              className="bg-gradient-to-r from-primary to-emerald-500 px-8 text-primary-foreground shadow-lg shadow-primary/20"
            >
              {analyzing ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-5 w-5" />
              )}
              {analyzing ? "Analyzing Repository…" : "Run X-Ray Analysis"}
            </Button>
          </div>
        ) : xray.status === "running" ? (
          /* Analysis in progress */
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Scanning repository...
            </p>
          </div>
        ) : xray.status === "error" ? (
          /* Error state */
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {xray.error ?? "Analysis failed"}
            </p>
            <Button type="button" variant="outline" onClick={handleRunAnalysis}>
              Retry
            </Button>
          </div>
        ) : (
          /* Results */
          <div className="space-y-6 p-6">
            {/* Score Overview */}
            {scores && (
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Production Readiness Scores
                  </CardTitle>
                  <CardDescription>
                    Overall score: {scores.overall}/100 — Based on{" "}
                    {findings.length} findings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-6 sm:grid-cols-6 lg:grid-cols-7">
                    <ScoreGauge
                      score={scores.overall}
                      label="Overall"
                      size="lg"
                    />
                    <ScoreGauge score={scores.completion} label="Completion" />
                    <ScoreGauge
                      score={scores.productionReadiness}
                      label="Production"
                    />
                    <ScoreGauge score={scores.security} label="Security" />
                    <ScoreGauge
                      score={scores.maintainability}
                      label="Maintainability"
                    />
                    <ScoreGauge
                      score={scores.performance}
                      label="Performance"
                    />
                    <ScoreGauge score={scores.deployment} label="Deployment" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Work Item Progress */}
            {workItemStats && workItemStats.total > 0 && (
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Play className="h-4 w-4 text-primary" />
                    Engineering Plan Progress
                  </CardTitle>
                  <CardDescription>
                    {workItemStats.completionPercent}% complete —{" "}
                    {workItemStats.byStatus?.done ?? 0}/{workItemStats.total}{" "}
                    items done
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={workItemStats.completionPercent}
                    className="h-2"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(workItemStats.byStatus ?? {}).map(
                      ([status, count]) => (
                        <Badge
                          key={status}
                          variant={
                            status === "done"
                              ? "default"
                              : status === "in_progress"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-xs"
                        >
                          {status.replace("_", " ")}: {count as number}
                        </Badge>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tabs for details */}
            <Tabs defaultValue="gaps" className="w-full">
              <TabsList className="mb-4 w-full justify-start bg-muted/50">
                <TabsTrigger value="gaps" className="gap-1.5">
                  <Flame className="h-3.5 w-3.5" />
                  Gaps ({gaps.length})
                </TabsTrigger>
                <TabsTrigger value="structure" className="gap-1.5">
                  <FolderTree className="h-3.5 w-3.5" />
                  Structure
                </TabsTrigger>
                <TabsTrigger value="deps" className="gap-1.5">
                  <Box className="h-3.5 w-3.5" />
                  Dependencies
                </TabsTrigger>
                <TabsTrigger value="api" className="gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  APIs
                </TabsTrigger>
                <TabsTrigger value="security" className="gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Security
                </TabsTrigger>
                <TabsTrigger value="tests" className="gap-1.5">
                  <TestTube2 className="h-3.5 w-3.5" />
                  Tests
                </TabsTrigger>
              </TabsList>

              {/* Gaps Tab */}
              <TabsContent value="gaps" className="space-y-3">
                {gaps.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No gaps detected. Run analysis to identify improvement
                    areas.
                  </div>
                ) : (
                  gaps.map(
                    (
                      gap: {
                        title: string;
                        description: string;
                        category: string;
                        priority: "critical" | "high" | "medium" | "low";
                        impact: number;
                        effort:
                          | "trivial"
                          | "small"
                          | "medium"
                          | "large"
                          | "epic";
                        dimension: string;
                      },
                      i: number,
                    ) => (
                      <GapCard
                        key={`${gap.title}-${i}`}
                        title={gap.title}
                        description={gap.description}
                        category={gap.category}
                        priority={gap.priority}
                        impact={gap.impact}
                        effort={gap.effort}
                        dimension={gap.dimension}
                      />
                    ),
                  )
                )}
              </TabsContent>

              {/* Structure Tab */}
              <TabsContent value="structure">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* File Stats */}
                  {fileStats && (
                    <Card className="border-border/30 bg-card/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <FileCode2 className="h-4 w-4 text-primary" />
                          File Statistics
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Total files
                          </span>
                          <span className="font-mono font-bold">
                            {fileStats.totalFiles}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Total lines
                          </span>
                          <span className="font-mono font-bold">
                            {fileStats.totalLines.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Total size
                          </span>
                          <span className="font-mono font-bold">
                            {(fileStats.totalBytes / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Languages */}
                  {languages && (
                    <Card className="border-border/30 bg-card/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Code2 className="h-4 w-4 text-primary" />
                          Languages
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Primary: {languages.primary}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-1.5">
                        {languages.all
                          .slice(0, 8)
                          .map(
                            (l: {
                              lang: string;
                              fileCount: number;
                              lineCount: number;
                              percentage: number;
                            }) => (
                              <div
                                key={l.lang}
                                className="flex items-center gap-2"
                              >
                                <div className="flex-1 text-xs">{l.lang}</div>
                                <div className="w-20">
                                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary/70"
                                      style={{ width: `${l.percentage}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                                  {l.percentage}%
                                </span>
                              </div>
                            ),
                          )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Infrastructure */}
                  {infrastructure && (
                    <Card className="border-border/30 bg-card/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <GitBranch className="h-4 w-4 text-primary" />
                          Infrastructure
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Docker</span>
                          <Badge
                            variant={
                              infrastructure.hasDocker ? "default" : "outline"
                            }
                            className="text-[10px]"
                          >
                            {infrastructure.hasDocker ? "Yes" : "No"}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">CI/CD</span>
                          <Badge
                            variant={
                              infrastructure.ciProvider ? "default" : "outline"
                            }
                            className="text-[10px]"
                          >
                            {infrastructure.ciProvider ?? "None"}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Deploy</span>
                          <Badge
                            variant={
                              infrastructure.deployTarget
                                ? "default"
                                : "outline"
                            }
                            className="text-[10px]"
                          >
                            {infrastructure.deployTarget ?? "None"}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Health Check
                          </span>
                          <Badge
                            variant={
                              infrastructure.hasHealthCheck
                                ? "default"
                                : "outline"
                            }
                            className="text-[10px]"
                          >
                            {infrastructure.hasHealthCheck ? "Yes" : "No"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Summary */}
                {xray?.summary && (
                  <Card className="mt-4 border-border/30 bg-card/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        AI Architectural Assessment
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {xray.summary}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Dependencies Tab */}
              <TabsContent value="deps">
                {dependencies ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Badge variant="outline">
                        {dependencies.packageManager}
                      </Badge>
                      <span>
                        {dependencies.runtime.length} runtime •{" "}
                        {dependencies.dev.length} dev •{" "}
                        {dependencies.lockFilePresent
                          ? "Lock file ✓"
                          : "No lock file ⚠️"}
                      </span>
                    </div>
                    <div className="grid gap-1">
                      {dependencies.runtime
                        .slice(0, 30)
                        .map(
                          (dep: {
                            name: string;
                            version: string;
                            type: string;
                          }) => (
                            <div
                              key={dep.name}
                              className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted/50"
                            >
                              <span className="font-mono font-medium">
                                {dep.name}
                              </span>
                              <span className="text-muted-foreground">
                                {dep.version}
                              </span>
                            </div>
                          ),
                        )}
                    </div>
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No dependency data available.
                  </p>
                )}
              </TabsContent>

              {/* APIs Tab */}
              <TabsContent value="api">
                {apis && apis.routes.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      {apis.totalEndpoints} endpoints detected •{" "}
                      {apis.frameworks.join(", ")}
                    </div>
                    <div className="rounded-lg border border-border/30">
                      {apis.routes.map(
                        (
                          route: {
                            method: string;
                            path: string;
                            file: string;
                            hasAuth: boolean;
                          },
                          i: number,
                        ) => (
                          <div
                            key={`${route.method}-${route.path}-${i}`}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 text-xs",
                              i > 0 && "border-t border-border/20",
                            )}
                          >
                            <Badge
                              variant="outline"
                              className={cn(
                                "w-16 justify-center font-mono text-[10px]",
                                route.method === "GET" &&
                                  "border-green-500/30 text-green-400",
                                route.method === "POST" &&
                                  "border-blue-500/30 text-blue-400",
                                route.method === "PUT" &&
                                  "border-yellow-500/30 text-yellow-400",
                                route.method === "DELETE" &&
                                  "border-red-500/30 text-red-400",
                              )}
                            >
                              {route.method}
                            </Badge>
                            <span className="flex-1 font-mono">
                              {route.path}
                            </span>
                            <span className="text-muted-foreground">
                              {route.file}
                            </span>
                            <Badge
                              variant={
                                route.hasAuth ? "default" : "destructive"
                              }
                              className="text-[10px]"
                            >
                              {route.hasAuth ? "Auth ✓" : "No Auth"}
                            </Badge>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No API endpoints detected.
                  </p>
                )}
              </TabsContent>

              {/* Security Tab */}
              <TabsContent value="security">
                {security ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <ScoreGauge
                        score={security.score}
                        label="Security Score"
                        size="sm"
                      />
                      <span className="text-sm text-muted-foreground">
                        {security.findings.length} finding(s)
                      </span>
                    </div>
                    {security.findings.map(
                      (
                        finding: {
                          severity: string;
                          title: string;
                          description: string;
                          category: string;
                          file?: string;
                          remediation: string;
                        },
                        i: number,
                      ) => (
                        <GapCard
                          key={`sec-${i}`}
                          title={finding.title}
                          description={finding.remediation}
                          category={finding.category}
                          priority={
                            (finding.severity === "critical" ||
                            finding.severity === "high"
                              ? finding.severity
                              : finding.severity === "medium"
                                ? "medium"
                                : "low") as
                              | "critical"
                              | "high"
                              | "medium"
                              | "low"
                          }
                          impact={
                            finding.severity === "critical"
                              ? 25
                              : finding.severity === "high"
                                ? 15
                                : 8
                          }
                          effort="small"
                          dimension="security"
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No security data available.
                  </p>
                )}
              </TabsContent>

              {/* Tests Tab */}
              <TabsContent value="tests">
                {tests ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Card className="border-border/30 bg-card/30">
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-primary">
                            {tests.testFiles.length}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Test Files
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="border-border/30 bg-card/30">
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-primary">
                            {tests.testCount}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Test Cases
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="border-border/30 bg-card/30">
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-primary">
                            {tests.framework ?? "None"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Framework
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                    {tests.testFiles.length > 0 && (
                      <div className="rounded-lg border border-border/30 p-3">
                        <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                          Test Files
                        </h4>
                        <div className="space-y-1">
                          {tests.testFiles.map((f: string) => (
                            <div
                              key={f}
                              className="flex items-center gap-2 text-xs"
                            >
                              <TestTube2 className="h-3 w-3 text-primary/50" />
                              <span className="font-mono">{f}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No test data available.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
