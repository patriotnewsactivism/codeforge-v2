/**
 * xray.ts — CodeForge ACSE Repository X-Ray Engine
 *
 * Phase 1 of the Autonomous Software Completion Engine.
 * Before writing code, CodeForge creates a complete digital representation
 * of the repository — the "Repository Digital Twin."
 *
 * Scan pipeline:
 *   1. File Discovery & Language Detection
 *   2. Dependency Mapping (package.json, requirements.txt, etc.)
 *   3. API Discovery (route patterns across frameworks)
 *   4. Database/ORM Analysis
 *   5. Test Coverage Mapping
 *   6. Security Analysis (secrets, missing auth, vuln patterns)
 *   7. Technical Debt Analysis (complexity, TODOs, duplication)
 *   8. Infrastructure Detection (Docker, CI, deploy configs)
 *   9. AI-Powered Summary Generation
 *
 * Result: A comprehensive XRayReport stored in the `xrayReports` table.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface LanguageInfo {
  lang: string;
  fileCount: number;
  lineCount: number;
  percentage: number;
}

export interface LanguageReport {
  primary: string;
  all: LanguageInfo[];
}

export interface Dependency {
  name: string;
  version: string;
  type: "runtime" | "dev" | "peer" | "optional";
}

export interface DependencyReport {
  runtime: Dependency[];
  dev: Dependency[];
  peer: Dependency[];
  packageManager: string;
  lockFilePresent: boolean;
}

export interface ApiRoute {
  method: string;
  path: string;
  file: string;
  line?: number;
  hasAuth: boolean;
}

export interface ApiReport {
  routes: ApiRoute[];
  totalEndpoints: number;
  frameworks: string[];
}

export interface DatabaseReport {
  orm: string | null;
  schemas: string[];
  migrations: string[];
  hasSeeds: boolean;
}

export interface TestReport {
  framework: string | null;
  testFiles: string[];
  testCount: number;
  coverageConfigPresent: boolean;
}

export interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  remediation: string;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  score: number;
}

export interface TechDebtFinding {
  category: string;
  title: string;
  description: string;
  file?: string;
  severity: "high" | "medium" | "low";
}

export interface TechDebtReport {
  findings: TechDebtFinding[];
  todoCount: number;
  fixmeCount: number;
  hackCount: number;
  largeFileCount: number;
  avgComplexity: number;
}

export interface InfrastructureReport {
  hasDocker: boolean;
  dockerFiles: string[];
  ciConfigs: string[];
  ciProvider: string | null;
  deployConfigs: string[];
  deployTarget: string | null;
  envTemplates: string[];
  hasHealthCheck: boolean;
}

export interface FileStats {
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  byLanguage: Record<string, { files: number; lines: number }>;
}

// ─── LANGUAGE DETECTION ─────────────────────────────────────────────────────

const LANG_EXTENSIONS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript (JSX)",
  js: "JavaScript",
  jsx: "JavaScript (JSX)",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C/C++ Header",
  php: "PHP",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  html: "HTML",
  vue: "Vue",
  svelte: "Svelte",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  sh: "Shell",
  bash: "Shell",
  dockerfile: "Dockerfile",
  tf: "Terraform",
  prisma: "Prisma",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protocol Buffers",
  xml: "XML",
};

function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? "";

  // Special filenames
  if (basename === "dockerfile" || basename.startsWith("dockerfile."))
    return "Dockerfile";
  if (basename === "makefile") return "Makefile";
  if (basename === ".gitignore") return "Git Config";
  if (basename === ".env" || basename.startsWith(".env.")) return "Environment";

  const ext = basename.includes(".") ? basename.split(".").pop() ?? "" : "";
  return LANG_EXTENSIONS[ext] ?? "Other";
}

function analyzeLanguages(
  files: { path: string; content: string; isDirectory: boolean }[],
): LanguageReport {
  const langMap: Record<string, { files: number; lines: number }> = {};
  const codeFiles = files.filter((f) => !f.isDirectory);

  for (const file of codeFiles) {
    const lang = detectLanguage(file.path);
    if (!langMap[lang]) langMap[lang] = { files: 0, lines: 0 };
    langMap[lang].files++;
    langMap[lang].lines += file.content.split("\n").length;
  }

  const totalLines = Object.values(langMap).reduce(
    (sum, v) => sum + v.lines,
    0,
  );
  const all: LanguageInfo[] = Object.entries(langMap)
    .map(([lang, stats]) => ({
      lang,
      fileCount: stats.files,
      lineCount: stats.lines,
      percentage: totalLines > 0 ? Math.round((stats.lines / totalLines) * 100) : 0,
    }))
    .sort((a, b) => b.lineCount - a.lineCount);

  return {
    primary: all[0]?.lang ?? "Unknown",
    all,
  };
}

// ─── DEPENDENCY MAPPING ─────────────────────────────────────────────────────

function analyzeDependencies(
  files: { path: string; content: string }[],
): DependencyReport {
  const report: DependencyReport = {
    runtime: [],
    dev: [],
    peer: [],
    packageManager: "unknown",
    lockFilePresent: false,
  };

  // Check for lock files
  const paths = files.map((f) => f.path);
  if (paths.some((p) => p.endsWith("package-lock.json"))) {
    report.packageManager = "npm";
    report.lockFilePresent = true;
  } else if (paths.some((p) => p.endsWith("yarn.lock"))) {
    report.packageManager = "yarn";
    report.lockFilePresent = true;
  } else if (paths.some((p) => p.endsWith("pnpm-lock.yaml"))) {
    report.packageManager = "pnpm";
    report.lockFilePresent = true;
  } else if (paths.some((p) => p.endsWith("bun.lock") || p.endsWith("bun.lockb"))) {
    report.packageManager = "bun";
    report.lockFilePresent = true;
  }

  // Parse package.json
  const pkgFile = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          report.runtime.push({ name, version: String(version), type: "runtime" });
        }
      }
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          report.dev.push({ name, version: String(version), type: "dev" });
        }
      }
      if (pkg.peerDependencies) {
        for (const [name, version] of Object.entries(pkg.peerDependencies)) {
          report.peer.push({ name, version: String(version), type: "peer" });
        }
      }
      if (!report.packageManager || report.packageManager === "unknown") {
        report.packageManager = "npm";
      }
    } catch {
      // Invalid package.json
    }
  }

  // Parse requirements.txt (Python)
  const reqFile = files.find(
    (f) =>
      f.path === "requirements.txt" ||
      f.path.endsWith("/requirements.txt"),
  );
  if (reqFile) {
    report.packageManager = "pip";
    const lines = reqFile.content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)([><=!~].+)?/);
      if (match) {
        report.runtime.push({
          name: match[1],
          version: match[2] ?? "*",
          type: "runtime",
        });
      }
    }
  }

  // Parse go.mod
  const goMod = files.find(
    (f) => f.path === "go.mod" || f.path.endsWith("/go.mod"),
  );
  if (goMod) {
    report.packageManager = "go modules";
    const requireBlock = goMod.content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      const lines = requireBlock[1].split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          report.runtime.push({
            name: parts[0],
            version: parts[1],
            type: "runtime",
          });
        }
      }
    }
  }

  return report;
}

// ─── API DISCOVERY ──────────────────────────────────────────────────────────

const API_PATTERNS: { regex: RegExp; method: string; framework: string }[] = [
  // Express / Koa / Fastify
  { regex: /\.(get|post|put|patch|delete|options|head)\s*\(\s*['"](\/[^'"]*)['"]/gi, method: "GET", framework: "Express" },
  // Next.js App Router
  { regex: /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/gi, method: "GET", framework: "Next.js" },
  // FastAPI (Python)
  { regex: /@app\.(get|post|put|patch|delete)\s*\(\s*['"](\/[^'"]*)['"]/gi, method: "GET", framework: "FastAPI" },
  // Flask (Python)
  { regex: /@app\.route\s*\(\s*['"](\/[^'"]*)['"]/gi, method: "GET", framework: "Flask" },
  // Django
  { regex: /path\s*\(\s*['"]([\w/]*)['"]/gi, method: "GET", framework: "Django" },
  // Convex HTTP routes
  { regex: /http\.route\s*\(\s*\{[\s\S]*?path:\s*['"](\/[^'"]*)['"]/gi, method: "GET", framework: "Convex" },
  // Gin (Go)
  { regex: /\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*['"](\/[^'"]*)['"]/gi, method: "GET", framework: "Gin" },
];

const AUTH_INDICATORS = [
  "auth", "authenticate", "authorize", "jwt", "token",
  "middleware", "guard", "protected", "bearer", "session",
  "getUserIdentity", "getAuthUserId", "requireAuth",
];

function analyzeApis(
  files: { path: string; content: string }[],
): ApiReport {
  const routes: ApiRoute[] = [];
  const frameworks = new Set<string>();

  for (const file of files) {
    for (const pattern of API_PATTERNS) {
      const matches = file.content.matchAll(pattern.regex);
      for (const match of matches) {
        const method = (match[1] || match[2] || "GET").toUpperCase();
        const path = match[2] || match[1] || "/";
        const surroundingCode = file.content.substring(
          Math.max(0, (match.index ?? 0) - 200),
          Math.min(file.content.length, (match.index ?? 0) + 500),
        );
        const hasAuth = AUTH_INDICATORS.some((indicator) =>
          surroundingCode.toLowerCase().includes(indicator),
        );

        routes.push({
          method,
          path,
          file: file.path,
          hasAuth,
        });
        frameworks.add(pattern.framework);
      }
    }
  }

  return {
    routes,
    totalEndpoints: routes.length,
    frameworks: Array.from(frameworks),
  };
}

// ─── DATABASE ANALYSIS ──────────────────────────────────────────────────────

function analyzeDatabase(
  files: { path: string; content: string }[],
): DatabaseReport {
  const report: DatabaseReport = {
    orm: null,
    schemas: [],
    migrations: [],
    hasSeeds: false,
  };

  for (const file of files) {
    const lower = file.path.toLowerCase();

    // ORM detection
    if (lower.endsWith("schema.prisma")) {
      report.orm = "Prisma";
      report.schemas.push(file.path);
    }
    if (lower.includes("schema.ts") && file.content.includes("defineSchema")) {
      report.orm = "Convex";
      report.schemas.push(file.path);
    }
    if (lower.includes("schema.ts") && file.content.includes("pgTable")) {
      report.orm = "Drizzle";
      report.schemas.push(file.path);
    }
    if (file.content.includes("mongoose.Schema") || file.content.includes("mongoose.model")) {
      report.orm = "Mongoose";
      report.schemas.push(file.path);
    }
    if (file.content.includes("Sequelize") || file.content.includes("sequelize")) {
      report.orm = "Sequelize";
      report.schemas.push(file.path);
    }
    if (file.content.includes("SQLAlchemy") || file.content.includes("declarative_base")) {
      report.orm = "SQLAlchemy";
      report.schemas.push(file.path);
    }
    if (file.content.includes("TypeORM") || file.content.includes("@Entity")) {
      report.orm = "TypeORM";
      report.schemas.push(file.path);
    }

    // Migration detection
    if (
      lower.includes("migration") ||
      lower.includes("migrate") ||
      lower.match(/\d{4,}.*\.(sql|ts|js)$/)
    ) {
      report.migrations.push(file.path);
    }

    // Seed detection
    if (lower.includes("seed")) {
      report.hasSeeds = true;
    }
  }

  return report;
}

// ─── TEST COVERAGE ──────────────────────────────────────────────────────────

function analyzeTests(
  files: { path: string; content: string }[],
): TestReport {
  const report: TestReport = {
    framework: null,
    testFiles: [],
    testCount: 0,
    coverageConfigPresent: false,
  };

  for (const file of files) {
    const lower = file.path.toLowerCase();

    // Test file detection
    if (
      lower.match(/\.(test|spec)\.(ts|tsx|js|jsx|py|rb|go)$/) ||
      lower.includes("__tests__/") ||
      lower.includes("tests/") ||
      lower.match(/test_.*\.py$/)
    ) {
      report.testFiles.push(file.path);
      // Count test cases (rough)
      const testMatches = file.content.match(
        /\b(it|test|describe|def test_|func Test)\s*\(/g,
      );
      report.testCount += testMatches?.length ?? 0;
    }

    // Framework detection
    if (file.content.includes("vitest")) report.framework = "Vitest";
    else if (file.content.includes("jest")) report.framework = "Jest";
    else if (file.content.includes("mocha")) report.framework = "Mocha";
    else if (file.content.includes("pytest")) report.framework = "Pytest";
    else if (file.content.includes("rspec")) report.framework = "RSpec";

    // Coverage config
    if (
      lower.includes("coverage") ||
      lower.includes(".nycrc") ||
      lower.includes("jest.config") ||
      lower.includes("vitest.config")
    ) {
      report.coverageConfigPresent = true;
    }
  }

  return report;
}

// ─── SECURITY ANALYSIS ──────────────────────────────────────────────────────

const SECRET_PATTERNS: { regex: RegExp; title: string; severity: SecurityFinding["severity"] }[] = [
  { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi, title: "Hardcoded API key", severity: "critical" },
  { regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, title: "Hardcoded password", severity: "critical" },
  { regex: /(?:secret|private[_-]?key)\s*[:=]\s*['"][a-zA-Z0-9_\-/+=]{16,}['"]/gi, title: "Hardcoded secret", severity: "critical" },
  { regex: /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['"][A-Za-z0-9/+=]{16,}['"]/gi, title: "AWS credentials in code", severity: "critical" },
  { regex: /ghp_[a-zA-Z0-9]{36,}/g, title: "GitHub Personal Access Token", severity: "critical" },
  { regex: /sk-[a-zA-Z0-9]{32,}/g, title: "OpenAI API key", severity: "critical" },
  { regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g, title: "Private key in code", severity: "critical" },
];

const SECURITY_CHECKS: { test: (content: string, path: string) => boolean; title: string; severity: SecurityFinding["severity"]; category: string; description: string; remediation: string }[] = [
  {
    test: (c) => /eval\s*\(/.test(c),
    title: "Use of eval()",
    severity: "high",
    category: "injection",
    description: "eval() can execute arbitrary code and is a common injection vector.",
    remediation: "Replace eval() with safer alternatives like JSON.parse() or Function constructors with validated input.",
  },
  {
    test: (c) => /dangerouslySetInnerHTML/.test(c),
    title: "dangerouslySetInnerHTML usage",
    severity: "medium",
    category: "xss",
    description: "dangerouslySetInnerHTML can lead to XSS if the content is not sanitized.",
    remediation: "Sanitize HTML content with DOMPurify or use React's built-in escaping.",
  },
  {
    test: (c, p) => p.endsWith(".env") && !p.includes(".example"),
    title: ".env file committed",
    severity: "high",
    category: "secrets",
    description: "Environment files with real secrets should not be in the repository.",
    remediation: "Add .env to .gitignore and use .env.example for templates.",
  },
  {
    test: (c) => /cors\s*\(\s*\{?\s*origin\s*:\s*['"]\*['"]/i.test(c),
    title: "CORS allows all origins",
    severity: "medium",
    category: "cors",
    description: "Wildcard CORS origin allows any website to make requests to your API.",
    remediation: "Restrict CORS to specific trusted domains.",
  },
  {
    test: (c) => /http:\/\/(?!localhost|127\.0\.0\.1)/.test(c),
    title: "Non-HTTPS URL in code",
    severity: "low",
    category: "transport",
    description: "HTTP URLs transmit data in plaintext.",
    remediation: "Use HTTPS for all external URLs.",
  },
];

function analyzeSecurity(
  files: { path: string; content: string }[],
): SecurityReport {
  const findings: SecurityFinding[] = [];

  for (const file of files) {
    // Skip node_modules, lock files, minified files
    if (
      file.path.includes("node_modules") ||
      file.path.includes(".lock") ||
      file.path.endsWith(".min.js")
    ) {
      continue;
    }

    // Check for hardcoded secrets
    for (const pattern of SECRET_PATTERNS) {
      const matches = file.content.matchAll(pattern.regex);
      for (const _match of matches) {
        findings.push({
          severity: pattern.severity,
          category: "secrets",
          title: pattern.title,
          description: `Found in ${file.path}`,
          file: file.path,
          remediation:
            "Move to environment variables. Use .env files locally and secrets management in production.",
        });
      }
    }

    // Run security checks
    for (const check of SECURITY_CHECKS) {
      if (check.test(file.content, file.path)) {
        findings.push({
          severity: check.severity,
          category: check.category,
          title: check.title,
          description: check.description,
          file: file.path,
          remediation: check.remediation,
        });
      }
    }
  }

  // Check for missing security features
  const allContent = files.map((f) => f.content).join("\n");
  const allPaths = files.map((f) => f.path);

  if (!allContent.includes("helmet") && allPaths.some((p) => p.includes("server") || p.includes("express"))) {
    findings.push({
      severity: "medium",
      category: "headers",
      title: "No security headers middleware (helmet)",
      description: "Server-side application missing security headers.",
      remediation: "Add helmet middleware for Express or equivalent security headers.",
    });
  }

  if (!allContent.includes("rate") && !allContent.includes("rateLimit")) {
    findings.push({
      severity: "low",
      category: "rate_limiting",
      title: "No rate limiting detected",
      description: "API endpoints may be vulnerable to abuse without rate limiting.",
      remediation: "Add rate limiting middleware (e.g., express-rate-limit).",
    });
  }

  // Score: 100 minus deductions per finding
  const deductions: Record<string, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
  };
  const totalDeduction = findings.reduce(
    (sum, f) => sum + (deductions[f.severity] ?? 0),
    0,
  );

  return {
    findings,
    score: Math.max(0, 100 - totalDeduction),
  };
}

// ─── TECHNICAL DEBT ─────────────────────────────────────────────────────────

function analyzeTechDebt(
  files: { path: string; content: string }[],
): TechDebtReport {
  const findings: TechDebtFinding[] = [];
  let todoCount = 0;
  let fixmeCount = 0;
  let hackCount = 0;
  let largeFileCount = 0;
  const complexities: number[] = [];

  for (const file of files) {
    if (file.path.includes("node_modules") || file.path.includes(".lock")) continue;

    const lines = file.content.split("\n");

    // Count annotations
    const todos = (file.content.match(/\/\/\s*TODO|#\s*TODO|\/\*\s*TODO/gi) ?? []).length;
    const fixmes = (file.content.match(/\/\/\s*FIXME|#\s*FIXME|\/\*\s*FIXME/gi) ?? []).length;
    const hacks = (file.content.match(/\/\/\s*HACK|#\s*HACK|\/\*\s*HACK/gi) ?? []).length;
    todoCount += todos;
    fixmeCount += fixmes;
    hackCount += hacks;

    if (todos > 3) {
      findings.push({
        category: "annotations",
        title: `${todos} TODO comments`,
        description: `File has ${todos} unresolved TODO comments.`,
        file: file.path,
        severity: "low",
      });
    }

    // Large files
    if (lines.length > 500) {
      largeFileCount++;
      findings.push({
        category: "complexity",
        title: "Large file",
        description: `${lines.length} lines — consider splitting into smaller modules.`,
        file: file.path,
        severity: lines.length > 1000 ? "high" : "medium",
      });
    }

    // Deep nesting (rough check)
    let maxIndent = 0;
    for (const line of lines) {
      const indent = line.search(/\S/);
      if (indent > 0) maxIndent = Math.max(maxIndent, indent);
    }
    // Assuming 2-space indent, 5+ levels is concerning
    const nestingDepth = Math.floor(maxIndent / 2);
    if (nestingDepth >= 8) {
      findings.push({
        category: "complexity",
        title: "Deep nesting detected",
        description: `${nestingDepth} levels of nesting — extract functions to reduce complexity.`,
        file: file.path,
        severity: "medium",
      });
    }

    // Simple cyclomatic complexity proxy: count control flow keywords
    const controlFlow = (
      file.content.match(
        /\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g,
      ) ?? []
    ).length;
    const complexity = controlFlow / Math.max(lines.length, 1);
    complexities.push(complexity);
  }

  const avgComplexity =
    complexities.length > 0
      ? complexities.reduce((a, b) => a + b, 0) / complexities.length
      : 0;

  return {
    findings,
    todoCount,
    fixmeCount,
    hackCount,
    largeFileCount,
    avgComplexity: Math.round(avgComplexity * 100) / 100,
  };
}

// ─── INFRASTRUCTURE DETECTION ───────────────────────────────────────────────

function analyzeInfrastructure(
  files: { path: string; content: string }[],
): InfrastructureReport {
  const report: InfrastructureReport = {
    hasDocker: false,
    dockerFiles: [],
    ciConfigs: [],
    ciProvider: null,
    deployConfigs: [],
    deployTarget: null,
    envTemplates: [],
    hasHealthCheck: false,
  };

  for (const file of files) {
    const lower = file.path.toLowerCase();

    // Docker
    if (lower.includes("dockerfile") || lower === "docker-compose.yml" || lower === "docker-compose.yaml") {
      report.hasDocker = true;
      report.dockerFiles.push(file.path);
    }

    // CI
    if (lower.includes(".github/workflows/")) {
      report.ciProvider = "GitHub Actions";
      report.ciConfigs.push(file.path);
    }
    if (lower.includes(".gitlab-ci")) {
      report.ciProvider = "GitLab CI";
      report.ciConfigs.push(file.path);
    }
    if (lower.includes(".circleci/")) {
      report.ciProvider = "CircleCI";
      report.ciConfigs.push(file.path);
    }
    if (lower.includes("jenkinsfile")) {
      report.ciProvider = "Jenkins";
      report.ciConfigs.push(file.path);
    }

    // Deploy configs
    if (lower === "vercel.json") {
      report.deployTarget = "Vercel";
      report.deployConfigs.push(file.path);
    }
    if (lower === "railway.json" || lower === "nixpacks.toml") {
      report.deployTarget = "Railway";
      report.deployConfigs.push(file.path);
    }
    if (lower === "netlify.toml") {
      report.deployTarget = "Netlify";
      report.deployConfigs.push(file.path);
    }
    if (lower === "fly.toml") {
      report.deployTarget = "Fly.io";
      report.deployConfigs.push(file.path);
    }
    if (lower.includes("terraform") || lower.endsWith(".tf")) {
      report.deployTarget = "Terraform";
      report.deployConfigs.push(file.path);
    }
    if (lower.includes("k8s") || lower.includes("kubernetes") || lower.endsWith(".yaml") && file.content.includes("apiVersion:")) {
      report.deployTarget = "Kubernetes";
      report.deployConfigs.push(file.path);
    }

    // Env templates
    if (lower.endsWith(".env.example") || lower.endsWith(".env.template") || lower.endsWith(".env.sample")) {
      report.envTemplates.push(file.path);
    }

    // Health check
    if (file.content.includes("/health") || file.content.includes("/healthz") || file.content.includes("healthCheck")) {
      report.hasHealthCheck = true;
    }
  }

  return report;
}

// ─── FILE STATS ─────────────────────────────────────────────────────────────

function computeFileStats(
  files: { path: string; content: string; isDirectory: boolean }[],
): FileStats {
  const codeFiles = files.filter((f) => !f.isDirectory);
  const byLanguage: Record<string, { files: number; lines: number }> = {};

  let totalLines = 0;
  let totalBytes = 0;

  for (const file of codeFiles) {
    const lang = detectLanguage(file.path);
    const lines = file.content.split("\n").length;
    const bytes = new Blob([file.content]).size;

    totalLines += lines;
    totalBytes += bytes;

    if (!byLanguage[lang]) byLanguage[lang] = { files: 0, lines: 0 };
    byLanguage[lang].files++;
    byLanguage[lang].lines += lines;
  }

  return {
    totalFiles: codeFiles.length,
    totalLines,
    totalBytes,
    byLanguage,
  };
}

// ─── DB OPERATIONS ──────────────────────────────────────────────────────────

export const createXRayReport = mutation({
  args: { projectId: v.id("projects") },
  returns: v.id("xrayReports"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("xrayReports", {
      projectId: args.projectId,
      status: "running",
      createdAt: Date.now(),
    });
  },
});

export const updateXRayReport = mutation({
  args: {
    reportId: v.id("xrayReports"),
    status: v.optional(
      v.union(
        v.literal("running"),
        v.literal("done"),
        v.literal("error"),
      ),
    ),
    languages: v.optional(v.string()),
    dependencies: v.optional(v.string()),
    apis: v.optional(v.string()),
    database: v.optional(v.string()),
    tests: v.optional(v.string()),
    security: v.optional(v.string()),
    techDebt: v.optional(v.string()),
    infrastructure: v.optional(v.string()),
    fileStats: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { reportId, ...patch } = args;
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(reportId, cleaned);
    return null;
  },
});

export const getLatestXRay = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("xrayReports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const listXRayReports = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("xrayReports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(10);
  },
});

// ─── MAIN X-RAY ACTION ─────────────────────────────────────────────────────

export const runXRay = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Create the report record
    const reportId: Id<"xrayReports"> = await ctx.runMutation(
      api.xray.createXRayReport,
      { projectId: args.projectId },
    );

    try {
      // 2. Fetch all project files
      const files = await ctx.runQuery(api.files.listByProject, {
        projectId: args.projectId,
      });

      if (!files || files.length === 0) {
        await ctx.runMutation(api.xray.updateXRayReport, {
          reportId,
          status: "error",
          error: "No files found in project. Import a repository first.",
          completedAt: Date.now(),
        });
        return "No files found in project.";
      }

      const codeFiles = files.filter(
        (f: { isDirectory: boolean }) => !f.isDirectory,
      );

      // 3. Emit thought: starting analysis
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "xray-engine",
        agentName: "X-Ray Engine",
        type: "analyze",
        content: `🔬 Starting X-Ray analysis of ${codeFiles.length} files...`,
        isStreaming: false,
      });

      // 4. Run all analyzers
      const languages = analyzeLanguages(files as any);
      const dependencies = analyzeDependencies(codeFiles as any);
      const apis = analyzeApis(codeFiles as any);
      const database = analyzeDatabase(codeFiles as any);
      const tests = analyzeTests(codeFiles as any);
      const security = analyzeSecurity(codeFiles as any);
      const techDebt = analyzeTechDebt(codeFiles as any);
      const infrastructure = analyzeInfrastructure(codeFiles as any);
      const fileStats = computeFileStats(files as any);

      // 5. Generate AI summary
      const analysisContext = JSON.stringify({
        languages: { primary: languages.primary, totalLanguages: languages.all.length },
        dependencies: { runtime: dependencies.runtime.length, dev: dependencies.dev.length, manager: dependencies.packageManager },
        apis: { totalEndpoints: apis.totalEndpoints, frameworks: apis.frameworks },
        database: { orm: database.orm, schemaCount: database.schemas.length },
        tests: { framework: tests.framework, testFiles: tests.testFiles.length, testCount: tests.testCount },
        security: { findingCount: security.findings.length, score: security.score, criticalCount: security.findings.filter((f) => f.severity === "critical").length },
        techDebt: { todoCount: techDebt.todoCount, largeFiles: techDebt.largeFileCount, avgComplexity: techDebt.avgComplexity },
        infrastructure: { hasDocker: infrastructure.hasDocker, ci: infrastructure.ciProvider, deploy: infrastructure.deployTarget },
        fileStats: { totalFiles: fileStats.totalFiles, totalLines: fileStats.totalLines },
      });

      let summary = "";
      try {
        const model = await getModelForRole(ctx, "architect");
        const { text } = await callAIWithFallback(
          [
            {
              role: "system",
              content:
                "You are a senior software architect analyzing a repository. Provide a concise 3-5 paragraph summary of the repository's architecture, strengths, gaps, and what needs to happen to make it production-ready. Be specific and actionable.",
            },
            {
              role: "user",
              content: `Analyze this repository:\n\n${analysisContext}\n\nFile listing:\n${codeFiles.map((f: any) => f.path).join("\n")}\n\nProvide your architectural assessment.`,
            },
          ],
          { model },
        );
        summary = text;
      } catch (err) {
        summary = `Repository contains ${fileStats.totalFiles} files across ${languages.all.length} languages (primary: ${languages.primary}). ${apis.totalEndpoints} API endpoints detected. ${security.findings.length} security findings. ${tests.testFiles.length} test files found.`;
      }

      // 6. Save results
      await ctx.runMutation(api.xray.updateXRayReport, {
        reportId,
        status: "done",
        languages: JSON.stringify(languages),
        dependencies: JSON.stringify(dependencies),
        apis: JSON.stringify(apis),
        database: JSON.stringify(database),
        tests: JSON.stringify(tests),
        security: JSON.stringify(security),
        techDebt: JSON.stringify(techDebt),
        infrastructure: JSON.stringify(infrastructure),
        fileStats: JSON.stringify(fileStats),
        summary,
        completedAt: Date.now(),
      });

      // 7. Emit completion thought
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "xray-engine",
        agentName: "X-Ray Engine",
        type: "done",
        content: `✅ X-Ray complete: ${fileStats.totalFiles} files, ${languages.primary} primary language, ${apis.totalEndpoints} endpoints, ${security.findings.length} security findings, ${tests.testFiles.length} test files.`,
        isStreaming: false,
      });

      return reportId;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.xray.updateXRayReport, {
        reportId,
        status: "error",
        error: errorMsg,
        completedAt: Date.now(),
      });
      return `X-Ray failed: ${errorMsg}`;
    }
  },
});
