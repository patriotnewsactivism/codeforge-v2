/**
 * contextAssembler.ts — Codebase-Aware Context Assembly
 *
 * The intelligence layer that makes agents context-aware. Combines:
 *   - Knowledge graph (entity relationships, change impact)
 *   - RAG search (keyword + structural matching)
 *   - Convention detection (infer style from existing code)
 *   - Temporal awareness (recent changes weighted higher)
 *
 * Every agent call goes through assembleContext() to build a focused,
 * relevant context window — not a blind dump of all project files.
 *
 * This is what surpasses Cursor's codebase understanding: persistent,
 * evolving project knowledge that compounds across sessions.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";

// Pre-codegen: new modules not yet in generated types
const selfApi = api as any;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AssembledContext {
  relevantFiles: { path: string; relevance: number; snippet: string }[];
  relatedEntities: { name: string; kind: string; filePath: string; signature?: string }[];
  conventions: string[];
  changeImpact?: { impactedCount: number; impactedEntities: string[] };
  summary: string;
  tokenEstimate: number;
}

// ─── Main Context Assembly ──────────────────────────────────────────────────

/**
 * Assemble focused context for an agent task.
 * Combines RAG search + knowledge graph + conventions into a single
 * context block optimized for the agent's token budget.
 */
export const assembleContext = action({
  args: {
    projectId: v.id("projects"),
    task: v.string(),
    targetFiles: v.optional(v.array(v.string())),
    maxTokens: v.optional(v.number()),
    includeImpact: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const maxTokens = args.maxTokens ?? 6000;
    const sections: string[] = [];
    let tokenBudget = maxTokens;

    // 1. RAG search: find relevant files by keyword
    try {
      const ragResults = await ctx.runAction(api.rag.search, {
        projectId: args.projectId,
        query: args.task,
        topK: 8,
      });

      if (ragResults.length > 0) {
        const fileSection = ragResults
          .slice(0, 5)
          .map((r: any) => `  ${r.path} (score: ${r.score.toFixed(1)})\n    ${r.snippet.slice(0, 200)}`)
          .join("\n");
        sections.push(`## Relevant Files (by search)\n${fileSection}`);
        tokenBudget -= Math.floor(fileSection.length / 4);
      }
    } catch { /* RAG optional */ }

    // 2. Knowledge graph: find related entities
    try {
      const entities: any[] = await ctx.runQuery(selfApi.knowledgeGraph.listEntities, {
        projectId: args.projectId,
        limit: 50,
      });

      // Score entities by name overlap with task keywords
      const taskWords = args.task.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const scored = entities
        .map((e: any) => {
          const nameMatch = taskWords.filter(w =>
            e.name.toLowerCase().includes(w) || w.includes(e.name.toLowerCase()),
          ).length;
          const kindBonus = e.kind === "component" || e.kind === "function" ? 1 : 0;
          return { ...e, relevance: nameMatch * 2 + kindBonus };
        })
        .filter((e: any) => e.relevance > 0)
        .sort((a: any, b: any) => b.relevance - a.relevance)
        .slice(0, 10);

      if (scored.length > 0) {
        const entitySection = scored
          .map((e: any) => `  [${e.kind}] ${e.name} (${e.filePath})${e.signature ? ` — ${e.signature.slice(0, 80)}` : ""}`)
          .join("\n");
        sections.push(`## Related Code Entities\n${entitySection}`);
        tokenBudget -= Math.floor(entitySection.length / 4);
      }
    } catch { /* knowledge graph optional */ }

    // 3. Change impact (if target files specified)
    if (args.includeImpact && args.targetFiles?.length) {
      try {
        for (const filePath of args.targetFiles.slice(0, 3)) {
          const impact: any = await ctx.runQuery(selfApi.knowledgeGraph.getChangeImpact, {
            projectId: args.projectId,
            filePath,
            depth: 2,
          });
          if (impact.impactedCount > 0) {
            sections.push(
              `## Change Impact: ${filePath}\n  ${impact.impactedCount} entities depend on this file:\n  ${impact.impactedEntities.slice(0, 8).join(", ")}`,
            );
          }
        }
      } catch { /* impact optional */ }
    }

    // 4. Convention detection
    try {
      const conventions = await detectConventions(ctx, args.projectId);
      if (conventions.length > 0) {
        sections.push(`## Project Conventions\n${conventions.map(c => `  - ${c}`).join("\n")}`);
      }
    } catch { /* conventions optional */ }

    // 5. Recent activity (temporal awareness)
    try {
      const recentThoughts: any[] = await ctx.runQuery(api.agentThoughts.listRecent, {
        projectId: args.projectId,
        limit: 5,
      });
      if (recentThoughts.length > 0) {
        const recentSection = recentThoughts
          .map((t: any) => `  [${t.agentName}] ${t.content.slice(0, 100)}`)
          .join("\n");
        sections.push(`## Recent Agent Activity\n${recentSection}`);
      }
    } catch { /* recent activity optional */ }

    if (sections.length === 0) {
      return "No relevant context found for this task.";
    }

    // Trim to budget
    let assembled = sections.join("\n\n");
    if (assembled.length > maxTokens * 4) {
      assembled = assembled.slice(0, maxTokens * 4) + "\n\n[...context truncated to fit token budget]";
    }

    return assembled;
  },
});

// ─── Convention Detection ───────────────────────────────────────────────────

/**
 * Infer project conventions from existing code patterns.
 * Returns a list of human-readable convention strings.
 */
async function detectConventions(
  ctx: any,
  projectId: Id<"projects">,
): Promise<string[]> {
  const files: any[] = await ctx.runQuery(api.files.listByProject, { projectId });
  const codeFiles = files.filter((f: any) => !f.isDirectory && f.path.match(/\.(ts|tsx)$/));
  const conventions: string[] = [];

  if (codeFiles.length === 0) return conventions;

  // Sample up to 10 files for pattern detection
  const sample = codeFiles.slice(0, 10);
  const allContent = sample.map((f: any) => f.content ?? "").join("\n");

  // Quote style
  const doubleQuotes = (allContent.match(/"/g) ?? []).length;
  const singleQuotes = (allContent.match(/'/g) ?? []).length;
  if (doubleQuotes > singleQuotes * 2) conventions.push("Uses double quotes for strings");
  else if (singleQuotes > doubleQuotes * 2) conventions.push("Uses single quotes for strings");

  // Semicolons
  const semicolons = (allContent.match(/;\s*$/gm) ?? []).length;
  if (semicolons > codeFiles.length * 5) conventions.push("Uses semicolons");

  // Component style
  const arrowComponents = (allContent.match(/export const \w+ = \(/g) ?? []).length;
  const functionComponents = (allContent.match(/export function [A-Z]/g) ?? []).length;
  if (arrowComponents > functionComponents) conventions.push("Prefers arrow function components (export const X = () => ...)");
  else if (functionComponents > arrowComponents) conventions.push("Prefers named function components (export function X() ...)");

  // Import style
  const aliasImports = (allContent.match(/from ["']@\//g) ?? []).length;
  const relativeImports = (allContent.match(/from ["']\.\.?\//g) ?? []).length;
  if (aliasImports > relativeImports) conventions.push("Uses @/ path aliases for imports");

  // Type vs interface
  const interfaces = (allContent.match(/export interface /g) ?? []).length;
  const types = (allContent.match(/export type /g) ?? []).length;
  if (interfaces > types) conventions.push("Prefers interface for object shapes");
  else if (types > interfaces) conventions.push("Prefers type aliases");

  // Error handling
  const tryCatch = (allContent.match(/try \{/g) ?? []).length;
  if (tryCatch > 3) conventions.push("Uses try/catch for error handling");

  // Naming
  const camelFns = (allContent.match(/(?:export )?(?:const|function) [a-z][a-zA-Z]+/g) ?? []).length;
  if (camelFns > 5) conventions.push("Uses camelCase for functions/variables");

  // Convex patterns
  if (allContent.includes("ctx.auth.getUserIdentity")) conventions.push("Convex: checks auth via getUserIdentity()");
  if (allContent.includes("v.id(")) conventions.push("Convex: uses typed v.id() references");

  return conventions.slice(0, 10);
}

// ─── Smart File Selection ───────────────────────────────────────────────────

/**
 * Given a task description, select the most relevant files for an agent
 * to read — combining knowledge graph relationships with RAG scoring.
 */
export const selectFilesForTask = action({
  args: {
    projectId: v.id("projects"),
    task: v.string(),
    maxFiles: v.optional(v.number()),
  },
  returns: v.array(v.object({
    path: v.string(),
    reason: v.string(),
    relevance: v.number(),
  })),
  handler: async (ctx, args): Promise<{ path: string; reason: string; relevance: number }[]> => {
    const maxFiles = args.maxFiles ?? 10;
    const fileScores = new Map<string, { score: number; reason: string }>();

    // Source 1: RAG keyword search
    try {
      const ragResults = await ctx.runAction(api.rag.search, {
        projectId: args.projectId,
        query: args.task,
        topK: maxFiles,
      });
      for (const r of ragResults as any[]) {
        const existing = fileScores.get(r.path);
        const newScore = (existing?.score ?? 0) + r.score;
        fileScores.set(r.path, { score: newScore, reason: "keyword match" });
      }
    } catch { /* optional */ }

    // Source 2: Knowledge graph entity name matching
    try {
      const entities: any[] = await ctx.runQuery(selfApi.knowledgeGraph.listEntities, {
        projectId: args.projectId,
        limit: 100,
      });
      const taskWords = args.task.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const e of entities) {
        const matches = taskWords.filter(w =>
          e.name.toLowerCase().includes(w) || w.includes(e.name.toLowerCase()),
        ).length;
        if (matches > 0) {
          const existing = fileScores.get(e.filePath);
          const newScore = (existing?.score ?? 0) + matches * 3;
          fileScores.set(e.filePath, {
            score: newScore,
            reason: `contains entity "${e.name}" (${e.kind})`,
          });
        }
      }
    } catch { /* optional */ }

    // Sort by score and return top N
    return Array.from(fileScores.entries())
      .map(([path, { score, reason }]) => ({ path, reason, relevance: score }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxFiles);
  },
});
