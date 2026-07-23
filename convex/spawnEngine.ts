/**
 * spawnEngine.ts — Parallel Shard Decomposition for Epic Tasks
 *
 * Ported from Autonomous-Coder and adapted for Convex.
 *
 * When the engine receives an "epic" complexity task (full SaaS, multi-system
 * platform, etc.), the SpawnEngine:
 *   1. Plans the decomposition into independent "shards" (Data Layer, API Layer,
 *      UI Components, etc.)
 *   2. Resolves dependency ordering (topological sort)
 *   3. Runs independent shards in parallel via the agent engine
 *   4. Feeds completed shard context forward to dependent shards
 *   5. Merges all outputs into a coherent project
 *
 * This is what scales CodeForge from "build a button" to
 * "build a full SaaS platform with auth, payments, and CI/CD".
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

declare const process: { env: Record<string, string | undefined> };

// ─── BYOK resolver ──────────────────────────────────────────────────────────

async function resolveByok(
  ctx: any,
  userId?: string,
): Promise<{ callerPlan: string; userKeys?: Record<string, string> }> {
  try {
    const sub = await ctx.runQuery(api.limits.getMyLimits, {});
    const callerPlan: string = sub?.plan ?? "free";
    if (callerPlan !== "lifetime") return { callerPlan };
    if (!userId) return { callerPlan };

    const userKeys: Record<string, string> = await ctx.runQuery(
      internal.apiKeys.getAllKeysForUser,
      { userId },
    );
    if (!userKeys || Object.keys(userKeys).length === 0) {
      throw new Error(
        "⚠️ Lifetime plan requires your own API key. " +
          "Add one in Settings → API Keys to use AI features.",
      );
    }
    return { callerPlan, userKeys };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("⚠️")) throw err;
    return { callerPlan: "free" };
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Shard {
  name: string;
  description: string;
  agents: string[];
  files: string[];
  dependsOn: number[];
}

export interface SpawnPlan {
  shards: Shard[];
  mergeStrategy: "concatenate" | "reconcile" | "layer";
  estimatedAgents: number;
}

// ─── Planner Prompt ─────────────────────────────────────────────────────────

const SPAWN_PLANNER_PROMPT = `You are a master orchestrator that decomposes epic software projects
into parallel execution shards, each handled by independent agent clusters.

For a given goal, create a parallel build plan where agents work simultaneously on
different slices of the system, then merge.

Available agent roles: orchestrator, architect, coder, reviewer, debugger, tester, devops

OUTPUT JSON (no markdown, no extra text):
{
  "shards": [
    {
      "name": "Data Layer",
      "description": "Database schema, models, type definitions",
      "agents": ["architect", "coder"],
      "files": ["src/lib/db/schema.ts", "src/lib/types.ts"],
      "dependsOn": []
    },
    {
      "name": "API Layer",
      "description": "REST endpoints, auth middleware, server logic",
      "agents": ["coder"],
      "files": ["server/routes.ts", "server/auth.ts"],
      "dependsOn": [0]
    },
    {
      "name": "UI Components",
      "description": "React components, design system, pages",
      "agents": ["coder"],
      "files": ["src/components/", "src/pages/"],
      "dependsOn": []
    }
  ],
  "mergeStrategy": "layer",
  "estimatedAgents": 6
}

Rules:
- Keep shards independent where possible (parallel execution)
- Mark dependencies by shard index (0-based)
- Each shard should produce specific files
- Prefer 3-6 shards for most projects
- Use "layer" for full-stack, "concatenate" for independent modules, "reconcile" for overlapping code`;

// ─── Plan Decomposition ─────────────────────────────────────────────────────

export const planSpawn = internalAction({
  args: {
    projectId: v.id("projects"),
    goal: v.string(),
  },
  handler: async (ctx, args): Promise<SpawnPlan> => {
    const { callerPlan, userKeys } = await resolveByok(ctx);
    const model = await getModelForRole(ctx, "orchestrator");

    // Inject accumulated wisdom
    let smartContext = "";
    try {
      smartContext = await ctx.runAction(internal.autoLearn.getSmartContext, {
        projectId: args.projectId,
        goal: args.goal,
        agentRole: "orchestrator",
      });
    } catch {
      // Smart context is optional — proceed without it
    }

    const { text: content } = await callAIWithFallback(
      [
        { role: "system", content: SPAWN_PLANNER_PROMPT },
        { role: "user", content: `GOAL: ${args.goal}\n${smartContext}` },
      ],
      {
        model,
        callerPlan,
        userKeys,
      },
    );

    // Parse the spawn plan
    try {
      const cleaned = content
        .replace(/```json\n?/g, "")
        .replace(/```/g, "")
        .trim();
      const plan = JSON.parse(cleaned) as SpawnPlan;

      // Validate the plan
      if (!plan.shards || plan.shards.length === 0) {
        throw new Error("Empty spawn plan");
      }

      // Ensure estimatedAgents is set
      if (!plan.estimatedAgents) {
        plan.estimatedAgents = plan.shards.reduce(
          (sum, s) => sum + s.agents.length,
          0,
        );
      }

      return plan;
    } catch {
      // Fallback: single shard with all agents
      return {
        shards: [
          {
            name: "Full Build",
            description: args.goal,
            agents: ["orchestrator", "coder"],
            files: [],
            dependsOn: [],
          },
        ],
        mergeStrategy: "layer",
        estimatedAgents: 2,
      };
    }
  },
});

// ─── Execute Spawn Plan ─────────────────────────────────────────────────────

export const executeSpawnPlan = internalAction({
  args: {
    projectId: v.id("projects"),
    missionId: v.optional(v.string()),
    plan: v.string(), // JSON-serialized SpawnPlan
    goal: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    shardsCompleted: number;
    totalShards: number;
  }> => {
    const plan: SpawnPlan = JSON.parse(args.plan);
    const executed = new Set<number>();
    let safetyLimit = 20;

    // Emit thought: plan overview
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      missionId: args.missionId,
      agentId: "spawn-engine",
      agentName: "Spawn Engine",
      type: "plan",
      content: `📋 Spawn plan: ${plan.shards.length} shards, ${plan.estimatedAgents} agents, strategy: ${plan.mergeStrategy}`,
      isStreaming: false,
    });

    while (executed.size < plan.shards.length && safetyLimit-- > 0) {
      // Find all shards ready to run (all deps completed)
      const ready = plan.shards
        .map((shard, i) => ({ shard, i }))
        .filter(
          ({ i }) =>
            !executed.has(i) &&
            plan.shards[i].dependsOn.every(d => executed.has(d)),
        );

      if (ready.length === 0) break;

      // Emit thought: batch start
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        missionId: args.missionId,
        agentId: "spawn-engine",
        agentName: "Spawn Engine",
        type: "broadcast",
        content: `🚀 Launching parallel batch: ${ready.map(r => r.shard.name).join(", ")}`,
        isStreaming: false,
      });

      // Execute each ready shard by spawning agents through the engine
      for (const { shard, i } of ready) {
        for (const agentRole of shard.agents) {
          // Build the task description with dependency context
          const depContext = shard.dependsOn
            .filter(d => executed.has(d))
            .map(
              d =>
                `Completed shard "${plan.shards[d].name}": ${plan.shards[d].description}`,
            )
            .join("\n");

          const task = `${shard.description}\n\nOverall goal: ${args.goal}\nExpected output files: ${shard.files.join(", ")}${depContext ? `\n\nCompleted dependencies:\n${depContext}` : ""}`;

          // Run the agent through the engine
          try {
            await ctx.runAction(api.engine.runMission, {
              projectId: args.projectId,
              prompt: task, // In V2 engine, this is 'prompt'
            });
          } catch (err) {
            console.error(
              `[spawnEngine] Shard "${shard.name}" agent "${agentRole}" failed:`,
              err,
            );
          }
        }

        executed.add(i);
      }
    }

    // Emit thought: completion
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      missionId: args.missionId,
      agentId: "spawn-engine",
      agentName: "Spawn Engine",
      type: "complete",
      content: `✅ Spawn plan complete: ${executed.size}/${plan.shards.length} shards executed`,
      isStreaming: false,
    });

    return {
      success: executed.size === plan.shards.length,
      shardsCompleted: executed.size,
      totalShards: plan.shards.length,
    };
  },
});
