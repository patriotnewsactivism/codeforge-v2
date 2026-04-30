import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("suggestions"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      title: v.string(),
      description: v.string(),
      category: v.string(),
      priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      status: v.union(
        v.literal("pending"),
        v.literal("implementing"),
        v.literal("done"),
        v.literal("dismissed")
      ),
      implementationPrompt: v.string(),
      generatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const updateStatus = mutation({
  args: {
    suggestionId: v.id("suggestions"),
    status: v.union(
      v.literal("pending"),
      v.literal("implementing"),
      v.literal("done"),
      v.literal("dismissed")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.suggestionId, { status: args.status });
    return null;
  },
});

export const addSuggestion = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    implementationPrompt: v.string(),
  },
  returns: v.id("suggestions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("suggestions", {
      ...args,
      status: "pending",
      generatedAt: Date.now(),
    });
  },
});

// AI analyzes project files and generates suggestions
export const generateSuggestions = action({
  args: { projectId: v.id("projects") },
  returns: v.number(),
  handler: async (ctx, args) => {
    // Get all project files
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });

    // Get existing suggestions to avoid duplicates
    const existing = await ctx.runQuery(api.suggestions.listByProject, {
      projectId: args.projectId,
    });
    const existingTitles = new Set(existing.map((s) => s.title.toLowerCase()));

    // Build a file summary for the AI
    const fileSummary = files
      .filter((f) => !f.isDirectory)
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 500)}`)
      .join("\n\n");

    const prompt = `Analyze this web project and suggest 3-5 great features to add. The project has these files:

${fileSummary}

Already suggested (skip these): ${existing.map((s) => s.title).join(", ") || "none"}

Return ONLY a JSON array (no markdown, no code fences) with objects like:
[
  {
    "title": "Feature Name",
    "description": "Brief description of what it does and why it's useful",
    "category": "ui|functionality|performance|ux|security",
    "priority": "high|medium|low",
    "implementationPrompt": "Detailed instructions for an AI to implement this feature"
  }
]`;

    try {
      const response = await fetch(
        `${VIKTOR_API_URL}/api/viktor-spaces/tools/call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_name: PROJECT_NAME,
            project_secret: PROJECT_SECRET,
            role: "quick_ai_search",
            arguments: { search_question: prompt },
          }),
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!json.success) throw new Error(json.error ?? "AI call failed");

      const text = json.result.search_response;

      // Parse the JSON from the response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return 0;

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        title: string;
        description: string;
        category: string;
        priority: string;
        implementationPrompt: string;
      }>;

      let added = 0;
      for (const s of suggestions) {
        if (existingTitles.has(s.title.toLowerCase())) continue;
        const priority = (["high", "medium", "low"].includes(s.priority)
          ? s.priority
          : "medium") as "high" | "medium" | "low";
        const category = ["ui", "functionality", "performance", "ux", "security"].includes(s.category)
          ? s.category
          : "functionality";
        await ctx.runMutation(api.suggestions.addSuggestion, {
          projectId: args.projectId,
          title: s.title,
          description: s.description,
          category,
          priority,
          implementationPrompt: s.implementationPrompt,
        });
        added++;
      }
      return added;
    } catch (e) {
      console.error("Failed to generate suggestions:", e);
      return 0;
    }
  },
});
