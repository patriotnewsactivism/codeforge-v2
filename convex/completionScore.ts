/**
 * completionScore.ts — CodeForge ACSE Completion Intelligence
 *
 * Phase 2 of the Autonomous Software Completion Engine.
 * Takes X-Ray data and computes production-readiness scores across 6 dimensions.
 *
 * Dimensions:
 *   1. Completion Score    — How complete is the app vs. its intended scope?
 *   2. Production Readiness — Can this ship today?
 *   3. Security Score       — Auth, secrets, CORS, CSP, etc.
 *   4. Maintainability      — Test coverage, documentation, code quality
 *   5. Performance          — Bundle size, queries, caching
 *   6. Deployment           — CI/CD, Docker, env config, health checks
 *
 * Each score includes:
 *   - Numeric value (0-100)
 *   - Letter grade (A-F)
 *   - Specific findings with severity and remediation
 *   - Prioritized gap list (what to fix first)
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";

import type {
  ApiReport,
  DatabaseReport,
  DependencyReport,
  FileStats,
  InfrastructureReport,
  LanguageReport,
  SecurityReport,
  TechDebtReport,
  TestReport,
} from "./xray";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface Finding {
  dimension: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  impact: number; // 0-100 how much fixing this improves the score
  remediation: string;
  category: string;
  file?: string;
}

export interface GapItem {
  title: string;
  description: string;
  category: string;
  priority: "critical" | "high" | "medium" | "low";
  impact: number;
  effort: "trivial" | "small" | "medium" | "large" | "epic";
  dimension: string;
}

export interface ScoreResult {
  overall: number;
  completion: number;
  productionReadiness: number;
  security: number;
  maintainability: number;
  performance: number;
  deployment: number;
  findings: Finding[];
  gaps: GapItem[];
}

// ─── GRADE UTILITY ──────────────────────────────────────────────────────────

export function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ─── SCORING FUNCTIONS ──────────────────────────────────────────────────────

function scoreCompletion(
  fileStats: FileStats,
  _languages: LanguageReport,
  deps: DependencyReport,
  apis: ApiReport,
  db: DatabaseReport,
  tests: TestReport,
  infra: InfrastructureReport,
): { score: number; findings: Finding[] } {
  let score = 50; // Start at neutral
  const findings: Finding[] = [];

  // Reward: Has code files
  if (fileStats.totalFiles > 0) score += 10;
  if (fileStats.totalFiles > 10) score += 5;
  if (fileStats.totalFiles > 50) score += 5;

  // Reward: Has dependencies (not a bare repo)
  if (deps.runtime.length > 0) score += 5;
  if (deps.lockFilePresent) score += 3;

  // Reward: Has API endpoints (app does something)
  if (apis.totalEndpoints > 0) score += 5;
  if (apis.totalEndpoints > 5) score += 3;

  // Reward: Has database layer
  if (db.orm) score += 5;
  if (db.schemas.length > 0) score += 3;

  // Reward: Has tests
  if (tests.testFiles.length > 0) score += 5;
  if (tests.testCount > 10) score += 3;

  // Reward: Has infrastructure
  if (infra.hasDocker || infra.deployTarget) score += 5;
  if (infra.ciProvider) score += 3;

  // Penalties
  if (fileStats.totalFiles === 0) {
    findings.push({
      dimension: "completion",
      severity: "critical",
      title: "Empty project",
      description: "No code files found.",
      impact: 50,
      remediation: "Add source code files to the project.",
      category: "structure",
    });
    score = 5;
  }

  if (apis.totalEndpoints === 0 && fileStats.totalFiles > 5) {
    findings.push({
      dimension: "completion",
      severity: "medium",
      title: "No API endpoints detected",
      description: "No REST, GraphQL, or RPC endpoints found.",
      impact: 10,
      remediation: "Add API routes if this is a server application.",
      category: "api",
    });
  }

  if (!db.orm && fileStats.totalFiles > 10) {
    findings.push({
      dimension: "completion",
      severity: "medium",
      title: "No database layer detected",
      description: "No ORM, schema, or database configuration found.",
      impact: 10,
      remediation: "Add a database layer if the app requires data persistence.",
      category: "database",
    });
  }

  return { score: Math.min(100, Math.max(0, score)), findings };
}

function scoreProductionReadiness(
  fileStats: FileStats,
  tests: TestReport,
  security: SecurityReport,
  infra: InfrastructureReport,
  deps: DependencyReport,
): { score: number; findings: Finding[] } {
  let score = 40;
  const findings: Finding[] = [];

  // Tests
  if (tests.testFiles.length > 0) score += 10;
  const testRatio =
    fileStats.totalFiles > 0
      ? tests.testFiles.length / fileStats.totalFiles
      : 0;
  if (testRatio > 0.1) score += 5;
  if (testRatio > 0.2) score += 5;
  if (testRatio < 0.05 && fileStats.totalFiles > 10) {
    findings.push({
      dimension: "productionReadiness",
      severity: "high",
      title: "Low test coverage",
      description: `Only ${tests.testFiles.length} test files for ${fileStats.totalFiles} source files (${Math.round(testRatio * 100)}% ratio).`,
      impact: 20,
      remediation:
        "Add unit tests for critical business logic and integration tests for API endpoints.",
      category: "testing",
    });
  }

  // Security baseline
  if (security.score >= 80) score += 10;
  else if (security.score >= 60) score += 5;
  const criticalFindings = security.findings.filter(
    f => f.severity === "critical",
  );
  if (criticalFindings.length > 0) {
    score -= criticalFindings.length * 10;
    findings.push({
      dimension: "productionReadiness",
      severity: "critical",
      title: `${criticalFindings.length} critical security finding(s)`,
      description:
        "Critical security issues must be resolved before production.",
      impact: 30,
      remediation: "Address all critical security findings immediately.",
      category: "security",
    });
  }

  // Infrastructure
  if (infra.ciProvider) score += 8;
  else {
    findings.push({
      dimension: "productionReadiness",
      severity: "high",
      title: "No CI/CD pipeline",
      description: "No continuous integration or deployment pipeline detected.",
      impact: 15,
      remediation:
        "Add GitHub Actions, GitLab CI, or equivalent CI/CD pipeline.",
      category: "infrastructure",
    });
  }

  if (infra.deployTarget) score += 5;
  if (infra.envTemplates.length > 0) score += 3;
  if (infra.hasHealthCheck) score += 3;

  // Lock file
  if (deps.lockFilePresent) score += 3;
  else if (deps.runtime.length > 0) {
    findings.push({
      dimension: "productionReadiness",
      severity: "medium",
      title: "No dependency lock file",
      description: "Builds may produce different results without a lock file.",
      impact: 8,
      remediation: "Commit your package-lock.json, yarn.lock, or equivalent.",
      category: "dependencies",
    });
  }

  return { score: Math.min(100, Math.max(0, score)), findings };
}

function scoreSecurity(securityReport: SecurityReport): {
  score: number;
  findings: Finding[];
} {
  const findings: Finding[] = securityReport.findings.map(f => ({
    dimension: "security",
    severity: f.severity as Finding["severity"],
    title: f.title,
    description: f.description,
    impact:
      f.severity === "critical"
        ? 25
        : f.severity === "high"
          ? 15
          : f.severity === "medium"
            ? 8
            : 3,
    remediation: f.remediation,
    category: f.category,
    file: f.file,
  }));

  return { score: securityReport.score, findings };
}

function scoreMaintainability(
  fileStats: FileStats,
  tests: TestReport,
  techDebt: TechDebtReport,
  languages: LanguageReport,
): { score: number; findings: Finding[] } {
  let score = 60;
  const findings: Finding[] = [];

  // Test coverage
  const testRatio =
    fileStats.totalFiles > 0
      ? tests.testFiles.length / fileStats.totalFiles
      : 0;
  if (testRatio > 0.2) score += 10;
  else if (testRatio > 0.1) score += 5;

  // Technical debt
  if (techDebt.todoCount > 20) {
    score -= 10;
    findings.push({
      dimension: "maintainability",
      severity: "medium",
      title: `${techDebt.todoCount} unresolved TODOs`,
      description: "High number of TODO comments indicates incomplete work.",
      impact: 10,
      remediation: "Address or create issues for each TODO comment.",
      category: "tech_debt",
    });
  }

  if (techDebt.largeFileCount > 5) {
    score -= 8;
    findings.push({
      dimension: "maintainability",
      severity: "medium",
      title: `${techDebt.largeFileCount} large files (>500 lines)`,
      description: "Large files are harder to understand and maintain.",
      impact: 8,
      remediation: "Split large files into smaller, focused modules.",
      category: "complexity",
    });
  }

  // Code complexity
  if (techDebt.avgComplexity > 0.3) {
    score -= 5;
    findings.push({
      dimension: "maintainability",
      severity: "low",
      title: "High average code complexity",
      description: `Average complexity score: ${techDebt.avgComplexity}`,
      impact: 5,
      remediation: "Extract complex logic into helper functions.",
      category: "complexity",
    });
  }

  // TypeScript usage bonus
  const tsInfo = languages.all.find(
    l => l.lang === "TypeScript" || l.lang === "TypeScript (JSX)",
  );
  if (tsInfo && tsInfo.percentage > 50) score += 8;

  // Documentation
  const mdFiles = languages.all.find(l => l.lang === "Markdown");
  if (mdFiles && mdFiles.fileCount > 1) score += 5;

  return { score: Math.min(100, Math.max(0, score)), findings };
}

function scorePerformance(
  _fileStats: FileStats,
  deps: DependencyReport,
  apis: ApiReport,
  _db: DatabaseReport,
): { score: number; findings: Finding[] } {
  let score = 70; // Assume decent by default
  const findings: Finding[] = [];

  // Check for heavy dependencies
  const heavyDeps = ["moment", "lodash", "underscore", "jquery", "bootstrap"];
  const foundHeavy = deps.runtime.filter(d =>
    heavyDeps.includes(d.name.toLowerCase()),
  );
  if (foundHeavy.length > 0) {
    score -= foundHeavy.length * 5;
    for (const dep of foundHeavy) {
      findings.push({
        dimension: "performance",
        severity: "medium",
        title: `Heavy dependency: ${dep.name}`,
        description: `${dep.name} adds significant bundle size.`,
        impact: 5,
        remediation: `Replace ${dep.name} with a lighter alternative (e.g., date-fns instead of moment).`,
        category: "bundle_size",
      });
    }
  }

  // Too many dependencies
  if (deps.runtime.length > 50) {
    score -= 5;
    findings.push({
      dimension: "performance",
      severity: "low",
      title: `${deps.runtime.length} runtime dependencies`,
      description:
        "Large dependency count can increase build time and bundle size.",
      impact: 5,
      remediation: "Audit dependencies and remove unused ones.",
      category: "bundle_size",
    });
  }

  // Unprotected endpoints (potential abuse)
  const unprotectedEndpoints = apis.routes.filter(r => !r.hasAuth);
  if (unprotectedEndpoints.length > 5) {
    score -= 3;
    findings.push({
      dimension: "performance",
      severity: "low",
      title: `${unprotectedEndpoints.length} unauthenticated endpoints`,
      description: "Unprotected endpoints are vulnerable to abuse and DDoS.",
      impact: 3,
      remediation: "Add authentication or rate limiting to public endpoints.",
      category: "api",
    });
  }

  return { score: Math.min(100, Math.max(0, score)), findings };
}

function scoreDeployment(
  infra: InfrastructureReport,
  deps: DependencyReport,
): { score: number; findings: Finding[] } {
  let score = 20;
  const findings: Finding[] = [];

  // CI/CD
  if (infra.ciProvider) {
    score += 20;
  } else {
    findings.push({
      dimension: "deployment",
      severity: "high",
      title: "No CI/CD pipeline",
      description: "No automated testing or deployment pipeline.",
      impact: 25,
      remediation: "Add a CI/CD pipeline (GitHub Actions recommended).",
      category: "ci",
    });
  }

  // Docker
  if (infra.hasDocker) {
    score += 15;
  } else {
    findings.push({
      dimension: "deployment",
      severity: "medium",
      title: "No Docker configuration",
      description: "No Dockerfile or docker-compose found.",
      impact: 15,
      remediation:
        "Add a Dockerfile for consistent build and deployment environments.",
      category: "containerization",
    });
  }

  // Deploy target
  if (infra.deployTarget) {
    score += 15;
  } else {
    findings.push({
      dimension: "deployment",
      severity: "high",
      title: "No deployment configuration",
      description:
        "No deployment target (Vercel, Railway, AWS, etc.) detected.",
      impact: 20,
      remediation: "Add deployment configuration for your target platform.",
      category: "deploy",
    });
  }

  // Env templates
  if (infra.envTemplates.length > 0) {
    score += 10;
  } else {
    findings.push({
      dimension: "deployment",
      severity: "medium",
      title: "No environment template",
      description: "No .env.example or equivalent template found.",
      impact: 10,
      remediation:
        "Create a .env.example file documenting all required environment variables.",
      category: "config",
    });
  }

  // Health check
  if (infra.hasHealthCheck) {
    score += 10;
  } else {
    findings.push({
      dimension: "deployment",
      severity: "low",
      title: "No health check endpoint",
      description: "No /health or /healthz endpoint detected.",
      impact: 5,
      remediation:
        "Add a health check endpoint for load balancers and monitoring.",
      category: "monitoring",
    });
  }

  // Lock file
  if (deps.lockFilePresent) score += 10;

  return { score: Math.min(100, Math.max(0, score)), findings };
}

// ─── MAIN SCORING FUNCTION ──────────────────────────────────────────────────

function computeAllScores(
  languages: LanguageReport,
  deps: DependencyReport,
  apis: ApiReport,
  db: DatabaseReport,
  tests: TestReport,
  security: SecurityReport,
  techDebt: TechDebtReport,
  infra: InfrastructureReport,
  fileStats: FileStats,
): ScoreResult {
  const completionResult = scoreCompletion(
    fileStats,
    languages,
    deps,
    apis,
    db,
    tests,
    infra,
  );
  const prodResult = scoreProductionReadiness(
    fileStats,
    tests,
    security,
    infra,
    deps,
  );
  const secResult = scoreSecurity(security);
  const maintResult = scoreMaintainability(
    fileStats,
    tests,
    techDebt,
    languages,
  );
  const perfResult = scorePerformance(fileStats, deps, apis, db);
  const deployResult = scoreDeployment(infra, deps);

  const allFindings = [
    ...completionResult.findings,
    ...prodResult.findings,
    ...secResult.findings,
    ...maintResult.findings,
    ...perfResult.findings,
    ...deployResult.findings,
  ];

  // Deduplicate findings by title
  const seen = new Set<string>();
  const uniqueFindings = allFindings.filter(f => {
    if (seen.has(f.title)) return false;
    seen.add(f.title);
    return true;
  });

  // Sort by severity then impact
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  uniqueFindings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5) ||
      b.impact - a.impact,
  );

  // Generate gap items from findings
  const gaps: GapItem[] = uniqueFindings
    .filter(f => f.severity !== "info")
    .map(f => ({
      title: f.title,
      description: f.remediation,
      category: f.category,
      priority:
        f.severity === "critical"
          ? "critical"
          : (f.severity as GapItem["priority"]),
      impact: f.impact,
      effort:
        f.impact >= 20
          ? ("large" as const)
          : f.impact >= 10
            ? ("medium" as const)
            : ("small" as const),
      dimension: f.dimension,
    }));

  // Weighted overall score
  const overall = Math.round(
    completionResult.score * 0.2 +
      prodResult.score * 0.25 +
      secResult.score * 0.2 +
      maintResult.score * 0.15 +
      perfResult.score * 0.1 +
      deployResult.score * 0.1,
  );

  return {
    overall,
    completion: completionResult.score,
    productionReadiness: prodResult.score,
    security: secResult.score,
    maintainability: maintResult.score,
    performance: perfResult.score,
    deployment: deployResult.score,
    findings: uniqueFindings,
    gaps,
  };
}

// ─── DB OPERATIONS ──────────────────────────────────────────────────────────

export const saveScores = mutation({
  args: {
    projectId: v.id("projects"),
    xrayReportId: v.id("xrayReports"),
    overall: v.number(),
    completion: v.number(),
    productionReadiness: v.number(),
    security: v.number(),
    maintainability: v.number(),
    performance: v.number(),
    deployment: v.number(),
    findings: v.string(),
    gapAnalysis: v.string(),
  },
  returns: v.id("completionScores"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("completionScores", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getLatestScores = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("completionScores")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const listScores = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("completionScores")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
  },
});

// ─── MAIN SCORING ACTION ───────────────────────────────────────────────────

export const computeScores = action({
  args: {
    projectId: v.id("projects"),
    xrayReportId: v.id("xrayReports"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch the X-Ray report
    const report = await ctx.runQuery(api.xray.getLatestXRay, {
      projectId: args.projectId,
    });

    if (report?.status !== "done") {
      return "X-Ray report not available. Run X-Ray first.";
    }

    // 2. Parse all X-Ray data
    const languages: LanguageReport = report.languages
      ? JSON.parse(report.languages)
      : { primary: "Unknown", all: [] };
    const deps: DependencyReport = report.dependencies
      ? JSON.parse(report.dependencies)
      : {
          runtime: [],
          dev: [],
          peer: [],
          packageManager: "unknown",
          lockFilePresent: false,
        };
    const apis: ApiReport = report.apis
      ? JSON.parse(report.apis)
      : { routes: [], totalEndpoints: 0, frameworks: [] };
    const db: DatabaseReport = report.database
      ? JSON.parse(report.database)
      : { orm: null, schemas: [], migrations: [], hasSeeds: false };
    const tests: TestReport = report.tests
      ? JSON.parse(report.tests)
      : {
          framework: null,
          testFiles: [],
          testCount: 0,
          coverageConfigPresent: false,
        };
    const security: SecurityReport = report.security
      ? JSON.parse(report.security)
      : { findings: [], score: 100 };
    const techDebt: TechDebtReport = report.techDebt
      ? JSON.parse(report.techDebt)
      : {
          findings: [],
          todoCount: 0,
          fixmeCount: 0,
          hackCount: 0,
          largeFileCount: 0,
          avgComplexity: 0,
        };
    const infra: InfrastructureReport = report.infrastructure
      ? JSON.parse(report.infrastructure)
      : {
          hasDocker: false,
          dockerFiles: [],
          ciConfigs: [],
          ciProvider: null,
          deployConfigs: [],
          deployTarget: null,
          envTemplates: [],
          hasHealthCheck: false,
        };
    const fileStats: FileStats = report.fileStats
      ? JSON.parse(report.fileStats)
      : { totalFiles: 0, totalLines: 0, totalBytes: 0, byLanguage: {} };

    // 3. Compute all scores
    const result = computeAllScores(
      languages,
      deps,
      apis,
      db,
      tests,
      security,
      techDebt,
      infra,
      fileStats,
    );

    // 4. Emit thought
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "scoring-engine",
      agentName: "Completion Intelligence",
      type: "done",
      content: `📊 Scores computed — Overall: ${result.overall}/100 (${scoreToGrade(result.overall)}) | Completion: ${result.completion} | Production: ${result.productionReadiness} | Security: ${result.security} | Maintainability: ${result.maintainability} | Performance: ${result.performance} | Deployment: ${result.deployment} | ${result.findings.length} findings, ${result.gaps.length} gaps identified.`,
      isStreaming: false,
    });

    // 5. Save scores
    const scoreId: Id<"completionScores"> = await ctx.runMutation(
      api.completionScore.saveScores,
      {
        projectId: args.projectId,
        xrayReportId: args.xrayReportId,
        overall: result.overall,
        completion: result.completion,
        productionReadiness: result.productionReadiness,
        security: result.security,
        maintainability: result.maintainability,
        performance: result.performance,
        deployment: result.deployment,
        findings: JSON.stringify(result.findings),
        gapAnalysis: JSON.stringify(result.gaps),
      },
    );

    return scoreId;
  },
});

// ─── COMBINED X-RAY + SCORE ACTION ──────────────────────────────────────────

export const runFullAnalysis = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Run X-Ray
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "acse-engine",
      agentName: "ACSE Engine",
      type: "analyze",
      content:
        "🚀 Starting full repository analysis: X-Ray → Scoring → Gap Analysis...",
      isStreaming: false,
    });

    const reportId: string = await ctx.runAction(api.xray.runXRay, {
      projectId: args.projectId,
    });

    // Check if X-Ray succeeded
    if (
      reportId.startsWith("X-Ray failed") ||
      reportId.startsWith("No files")
    ) {
      return reportId;
    }

    // 2. Run Scoring
    const scoreId: string = await ctx.runAction(
      api.completionScore.computeScores,
      {
        projectId: args.projectId,
        xrayReportId: reportId as Id<"xrayReports">,
      },
    );

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "acse-engine",
      agentName: "ACSE Engine",
      type: "complete",
      content: "✅ Full analysis complete. Scores and gap analysis are ready.",
      isStreaming: false,
    });

    return `Analysis complete. Report: ${reportId}, Scores: ${scoreId}`;
  },
});
