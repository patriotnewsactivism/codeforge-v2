/**
 * sentry.ts — CodeForge Sentry Agent
 *
 * Real-time tool call monitoring against the MCP manifest.
 * Every tool call an agent makes is checked before execution:
 *   - Is this tool allowed for this agent role?
 *   - Is this tool allowed at this spawn depth?
 *   - Does this call match known dangerous patterns?
 *   - Has this agent exceeded its rate limits?
 *
 * The Sentry runs on the fast model (Grok 3 Fast) — it must be sub-100ms.
 * On violation: BLOCK the call, log the incident, alert the thought stream.
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ─── MCP MANIFEST ──────────────────────────────────────────────────────────
// Defines what each agent role is allowed to do.

export type AgentRole =
  | "orchestrator"
  | "architect"
  | "coder"
  | "reviewer"
  | "debugger"
  | "tester"
  | "devops"
  | "sentry"
  | "forensic"
  | "reflection"
  | "strategist";

export type ToolName =
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "read_file"
  | "list_files"
  | "search_files"
  | "spawn_agent"
  | "send_message"
  | "complete_task"
  | "git_commit"
  | "deploy";

interface RolePolicy {
  allowedTools: ToolName[];
  maxSpawnDepth: number;        // max depth this role can spawn children
  canSpawnRoles: AgentRole[];   // which child roles this role can spawn
  maxCallsPerMinute: number;    // rate limit
  requiresDebateFor: ToolName[]; // tools that need debate approval first
}

export const MCP_MANIFEST: Record<AgentRole, RolePolicy> = {
  orchestrator: {
    allowedTools: ["list_files", "read_file", "spawn_agent", "send_message", "complete_task"],
    maxSpawnDepth: 5,
    canSpawnRoles: ["architect", "coder", "reviewer", "debugger", "tester", "devops"],
    maxCallsPerMinute: 60,
    requiresDebateFor: [],
  },
  architect: {
    allowedTools: ["create_file", "list_files", "read_file", "send_message", "complete_task"],
    maxSpawnDepth: 3,
    canSpawnRoles: ["coder", "tester"],
    maxCallsPerMinute: 30,
    requiresDebateFor: ["create_file"],
  },
  coder: {
    allowedTools: ["create_file", "edit_file", "read_file", "list_files", "search_files", "send_message", "complete_task"],
    maxSpawnDepth: 2,
    canSpawnRoles: ["debugger", "tester"],
    maxCallsPerMinute: 120,
    requiresDebateFor: [],
  },
  reviewer: {
    allowedTools: ["read_file", "list_files", "search_files", "send_message", "complete_task"],
    maxSpawnDepth: 0,   // reviewers don't spawn
    canSpawnRoles: [],
    maxCallsPerMinute: 30,
    requiresDebateFor: [],
  },
  debugger: {
    allowedTools: ["read_file", "edit_file", "list_files", "search_files", "send_message", "complete_task"],
    maxSpawnDepth: 1,
    canSpawnRoles: ["tester"],
    maxCallsPerMinute: 60,
    requiresDebateFor: [],
  },
  tester: {
    allowedTools: ["create_file", "edit_file", "read_file", "list_files", "send_message", "complete_task"],
    maxSpawnDepth: 0,
    canSpawnRoles: [],
    maxCallsPerMinute: 60,
    requiresDebateFor: [],
  },
  devops: {
    allowedTools: ["read_file", "list_files", "git_commit", "deploy", "send_message", "complete_task"],
    maxSpawnDepth: 1,
    canSpawnRoles: [],
    maxCallsPerMinute: 10,   // deploys are expensive — strict rate limit
    requiresDebateFor: ["deploy", "git_commit"],
  },
  sentry: {
    allowedTools: ["read_file", "list_files", "search_files"],  // sentry is read-only
    maxSpawnDepth: 0,
    canSpawnRoles: [],
    maxCallsPerMinute: 300,
    requiresDebateFor: [],
  },
  forensic: {
    allowedTools: ["read_file", "list_files", "search_files", "send_message", "complete_task"],
    maxSpawnDepth: 1,
    canSpawnRoles: ["debugger"],
    maxCallsPerMinute: 20,
    requiresDebateFor: [],
  },
  reflection: {
    allowedTools: ["read_file", "list_files", "create_file", "send_message", "complete_task"],
    maxSpawnDepth: 0,
    canSpawnRoles: [],
    maxCallsPerMinute: 10,
    requiresDebateFor: ["create_file"],
  },
  strategist: {
    allowedTools: ["read_file", "list_files", "send_message", "complete_task"],
    maxSpawnDepth: 2,
    canSpawnRoles: ["architect", "forensic"],
    maxCallsPerMinute: 10,
    requiresDebateFor: [],
  },
};

// ─── DANGEROUS PATTERNS ────────────────────────────────────────────────────
// File paths and content patterns that always require extra scrutiny

const DANGEROUS_PATH_PATTERNS = [
  /convex\/auth/i,
  /convex\/schema/i,
  /\.env/i,
  /secret|password|credential|token|key/i,
  /package\.json$/i,
  /convex\.json$/i,
];

const DANGEROUS_CONTENT_PATTERNS = [
  /process\.env\./,
  /eval\(/,
  /Function\(/,
  /require\(['"]child_process/,
  /exec\(|spawn\(/,
  /DROP TABLE|DELETE FROM|TRUNCATE/i,
];

// ─── DB MUTATIONS & QUERIES ────────────────────────────────────────────────

export const logViolation = mutation({
  args: {
    projectId: v.id("projects"),
    agentId: v.string(),
    agentRole: v.string(),
    tool: v.string(),
    args: v.string(),
    violationType: v.union(
      v.literal("unauthorized_tool"),
      v.literal("spawn_depth_exceeded"),
      v.literal("unauthorized_spawn"),
      v.literal("rate_limit_exceeded"),
      v.literal("dangerous_pattern"),
      v.literal("debate_required"),
    ),
    details: v.string(),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    blocked: v.boolean(),
  },
  returns: v.id("sentryViolations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("sentryViolations", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const listViolations = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
    severity: v.optional(v.union(
      v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")
    )),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("sentryViolations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 100);
    if (args.severity) return all.filter((v) => v.severity === args.severity);
    return all;
  },
});

export const getViolationStats = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("sentryViolations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      total: all.length,
      blocked: all.filter((v) => v.blocked).length,
      byType: all.reduce((acc, v) => {
        acc[v.violationType] = (acc[v.violationType] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      bySeverity: {
        critical: all.filter((v) => v.severity === "critical").length,
        high: all.filter((v) => v.severity === "high").length,
        medium: all.filter((v) => v.severity === "medium").length,
        low: all.filter((v) => v.severity === "low").length,
      },
    };
  },
});

// ─── CORE: checkToolCall ───────────────────────────────────────────────────
// Called by engine.ts BEFORE every tool execution.
// Returns { allowed, reason, requiresDebate }

export const checkToolCall = action({
  args: {
    projectId: v.id("projects"),
    agentId: v.string(),
    agentRole: v.string(),
    tool: v.string(),
    toolArgs: v.string(),   // JSON stringified tool args
    spawnDepth: v.number(),
    callsThisMinute: v.optional(v.number()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    requiresDebate: v.boolean(),
    severity: v.optional(v.union(
      v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")
    )),
  }),
  handler: async (ctx, args) => {
    const role = (args.agentRole.toLowerCase() as AgentRole);
    const policy = MCP_MANIFEST[role] ?? MCP_MANIFEST.coder;
    const tool = args.tool as ToolName;

    // ── Check 1: Is this tool allowed for this role? ───────────────────────
    if (!policy.allowedTools.includes(tool)) {
      await ctx.runMutation(api.sentry.logViolation, {
        projectId: args.projectId,
        agentId: args.agentId,
        agentRole: args.agentRole,
        tool: args.tool,
        args: args.toolArgs,
        violationType: "unauthorized_tool",
        details: `Role "${args.agentRole}" is not permitted to call "${args.tool}". Allowed: ${policy.allowedTools.join(", ")}`,
        severity: "high",
        blocked: true,
      });
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "sentry",
        agentName: "🔒 Sentry",
        type: "error",
        content: `BLOCKED: ${args.agentRole} tried unauthorized tool "${args.tool}"`,
        isStreaming: false,
      });
      return { allowed: false, reason: `Role "${args.agentRole}" cannot call "${args.tool}"`, requiresDebate: false, severity: "high" as const };
    }

    // ── Check 2: Spawn depth ───────────────────────────────────────────────
    if (tool === "spawn_agent" && args.spawnDepth >= policy.maxSpawnDepth) {
      await ctx.runMutation(api.sentry.logViolation, {
        projectId: args.projectId,
        agentId: args.agentId,
        agentRole: args.agentRole,
        tool: args.tool,
        args: args.toolArgs,
        violationType: "spawn_depth_exceeded",
        details: `Spawn depth ${args.spawnDepth} exceeds max ${policy.maxSpawnDepth} for role "${args.agentRole}"`,
        severity: "medium",
        blocked: true,
      });
      return { allowed: false, reason: `Max spawn depth (${policy.maxSpawnDepth}) exceeded for "${args.agentRole}"`, requiresDebate: false, severity: "medium" as const };
    }

    // ── Check 3: Unauthorized spawn target ────────────────────────────────
    if (tool === "spawn_agent") {
      try {
        const spawnArgs = JSON.parse(args.toolArgs) as { role?: string };
        const targetRole = (spawnArgs.role ?? "").toLowerCase() as AgentRole;
        if (targetRole && !policy.canSpawnRoles.includes(targetRole)) {
          await ctx.runMutation(api.sentry.logViolation, {
            projectId: args.projectId,
            agentId: args.agentId,
            agentRole: args.agentRole,
            tool: args.tool,
            args: args.toolArgs,
            violationType: "unauthorized_spawn",
            details: `Role "${args.agentRole}" cannot spawn "${targetRole}". Allowed: ${policy.canSpawnRoles.join(", ")}`,
            severity: "high",
            blocked: true,
          });
          return { allowed: false, reason: `"${args.agentRole}" cannot spawn "${targetRole}"`, requiresDebate: false, severity: "high" as const };
        }
      } catch { /* JSON parse fail — let it through, engine will handle */ }
    }

    // ── Check 4: Rate limiting ─────────────────────────────────────────────
    if ((args.callsThisMinute ?? 0) > policy.maxCallsPerMinute) {
      await ctx.runMutation(api.sentry.logViolation, {
        projectId: args.projectId,
        agentId: args.agentId,
        agentRole: args.agentRole,
        tool: args.tool,
        args: args.toolArgs,
        violationType: "rate_limit_exceeded",
        details: `${args.callsThisMinute} calls/min exceeds limit of ${policy.maxCallsPerMinute} for "${args.agentRole}"`,
        severity: "medium",
        blocked: true,
      });
      return { allowed: false, reason: `Rate limit exceeded (${args.callsThisMinute}/${policy.maxCallsPerMinute} calls/min)`, requiresDebate: false, severity: "medium" as const };
    }

    // ── Check 5: Dangerous path/content patterns ──────────────────────────
    try {
      const toolArgs = JSON.parse(args.toolArgs) as Record<string, string>;
      const path = toolArgs.path ?? "";
      const content = toolArgs.content ?? "";

      const dangerousPath = DANGEROUS_PATH_PATTERNS.some((p) => p.test(path));
      const dangerousContent = DANGEROUS_CONTENT_PATTERNS.some((p) => p.test(content));

      if (dangerousPath && (tool === "edit_file" || tool === "create_file" || tool === "delete_file")) {
        const severity = tool === "delete_file" ? "critical" : "high";
        await ctx.runMutation(api.sentry.logViolation, {
          projectId: args.projectId,
          agentId: args.agentId,
          agentRole: args.agentRole,
          tool: args.tool,
          args: args.toolArgs,
          violationType: "dangerous_pattern",
          details: `Sensitive path detected: "${path}" — requires debate approval`,
          severity,
          blocked: false,   // not blocked, but flags for debate
        });
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId: args.projectId,
          agentId: "sentry",
          agentName: "🔒 Sentry",
          type: "warning",
          content: `⚠️ Sensitive path "${path}" — debate required before ${tool}`,
          isStreaming: false,
        });
        return { allowed: true, requiresDebate: true, severity: severity as "high" | "critical" };
      }

      if (dangerousContent) {
        await ctx.runMutation(api.sentry.logViolation, {
          projectId: args.projectId,
          agentId: args.agentId,
          agentRole: args.agentRole,
          tool: args.tool,
          args: args.toolArgs.slice(0, 500),
          violationType: "dangerous_pattern",
          details: `Dangerous content pattern detected in "${path}"`,
          severity: "high",
          blocked: false,
        });
        return { allowed: true, requiresDebate: true, severity: "high" as const };
      }
    } catch { /* JSON parse fail — pass through */ }

    // ── Check 6: Debate required by policy ────────────────────────────────
    if (policy.requiresDebateFor.includes(tool)) {
      return { allowed: true, requiresDebate: true, severity: "low" as const };
    }

    // All checks passed ✅
    return { allowed: true, requiresDebate: false };
  },
});



