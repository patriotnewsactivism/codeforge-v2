/**
 * rag.ts — Retrieval-Augmented Generation for Agent Context
 *
 * Agents can't hold the whole project in their context window (yet).
 * This module provides simple keyword and semantic search over project files.
 *
 * It uses a simple in-memory BM25-like scoring for now, but is designed
 * to be swapped for Convex vector search later.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";

// ─── DB OPERATIONS ───────────────────────────────────────────────────────────

export const listAllProjectFiles = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const updateFileTags = mutation({
  args: {
    fileId: v.id("files"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, { tags: args.tags } as any);
  },
});

// ─── ACTIONS ─────────────────────────────────────────────────────────────────

/**
 * indexProject — runs a background scan of all files to extract tags
 * for better searchability.
 */
export const indexProject = action({
  args: { projectId: v.id("projects") },
  returns: v.object({ filesIndexed: v.number() }),
  handler: async (ctx, args): Promise<{ filesIndexed: number }> => {
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });

    const codeFiles = (files as any[]).filter((f: any) => !f.isDirectory);

    for (const file of codeFiles) {
      // Basic extension-based and keyword-based tagging
      const tags: string[] = [];
      const ext = file.path.split(".").pop()?.toLowerCase();
      if (ext) tags.push(ext);

      const content = file.content.toLowerCase();
      if (content.includes("import react")) tags.push("react");
      if (content.includes("convex")) tags.push("convex");
      if (content.includes("interface ") || content.includes("type "))
        tags.push("types");
      if (content.includes("test(") || content.includes("it(")) tags.push("test");

      await ctx.runMutation(api.rag.updateFileTags, {
        fileId: file._id,
        tags,
      });
    }

    return { filesIndexed: codeFiles.length };
  },
});

/**
 * search — performs keyword search across project files.
 * Scores by keyword frequency in content, title matches, and tag relevance.
 */
export const search = action({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    topK: v.optional(v.number()),
    filterLanguage: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      path: v.string(),
      score: v.number(),
      tags: v.array(v.string()),
      snippet: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<Array<{ path: string; score: number; tags: string[]; snippet: string }>> => {
    const files: any[] = await ctx.runQuery(api.rag.listAllProjectFiles, {
      projectId: args.projectId,
    });

    const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!queryWords.length) return [];

    const results = (files as any[]).filter((f: any) => {
      if (f.isDirectory) return false;
      if (args.filterLanguage && !f.path.endsWith(args.filterLanguage))
        return false;
      return true;
    });

    const scored = results.map((entry: any) => {
      let score = 0;
      const content = entry.content.toLowerCase();

      // Bonus for exact word matches in content
      for (const word of queryWords) {
        if (content.includes(word)) score += 1;
        // Even more for title match
        if (entry.path.toLowerCase().includes(word)) score += 5;
      }

      // Tag bonus
      const tagBonus =
        entry.tags?.filter((tag: string) =>
          queryWords.some(
            (w: string) => tag.toLowerCase().includes(w) || w.includes(tag.toLowerCase()),
          ),
        ).length ?? 0 * 0.15;

      score += tagBonus;

      // Bonus for path matching query words
      const pathBonus =
        queryWords.filter((w: string) => entry.path.toLowerCase().includes(w)).length *
        0.1;

      score += pathBonus;

      return { entry, score };
    });

    // Sort by score, take top K
    scored.sort((a: any, b: any) => b.score - a.score);
    const top = scored.slice(0, args.topK ?? 10);

    return top.map((s: any) => {
      // Find the first occurrence of any query word for the snippet
      const content = s.entry.content;
      const lower = content.toLowerCase();
      let bestIndex = 0;
      for (const word of queryWords) {
        const idx = lower.indexOf(word);
        if (idx !== -1) {
          bestIndex = idx;
          break;
        }
      }

      const start = Math.max(0, bestIndex - 100);
      const end = Math.min(content.length, bestIndex + 200);
      let snippet = content.slice(start, end);
      if (start > 0) snippet = "..." + snippet;
      if (end < content.length) snippet = snippet + "...";

      return {
        path: s.entry.path,
        score: s.score,
        tags: s.entry.tags ?? [],
        snippet,
      };
    });
  },
});

/**
 * getContextForPrompt — Convenience function for agents.
 * Searches and formats the top results as a prompt block.
 */
export const getContextForPrompt = action({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    maxTokens: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string> => {
    const results = await ctx.runAction(api.rag.search, {
      projectId: args.projectId,
      query: args.query,
      topK: 5,
    });

    if (!results.length) return "No relevant files found for this query.";

    let block = "### Relevant Code Context\n\n";
    for (const res of results) {
      block += `--- ${res.path} (score: ${res.score.toFixed(1)}) ---\n`;
      block += `${res.snippet}\n\n`;
    }

    // Rough token limit
    if (args.maxTokens && block.length > args.maxTokens * 4) {
      block = block.slice(0, args.maxTokens * 4) + "... [truncated]";
    }

    return block;
  },
});
