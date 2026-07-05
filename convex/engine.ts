/**
 * engine.ts — CodeForge v2 Agentic Tool-Calling Loop
 *
 * Agents use tools, not text parsing.
 * AI returns structured JSON → tools execute → results feed back → AI continues.
 *
 * Tools: create_file, edit_file, delete_file, read_file, list_files,
 *        search_files, spawn_agent, send_message, complete_task
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── BYOK: Resolve caller plan + API keys ────────────────────────────────────
// Lifetime users get their stored keys injected into AI calls.
// Weekly/monthly/free users use platform process.env keys (no userKeys passed).
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
      api.apiKeys.getAllKeysForUser,
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

// ─── TOOL CALL SCHEMA ──────────────────────────────────────────────────────

export type ToolName =
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "read_file"
  | "list_files"
  | "search_files"
  | "get_context"
  | "web_search"
  | "spawn_agent"
  | "send_message"
  | "deploy_project"
  | "complete_task";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool: ToolName;
  success: boolean;
  output: string;
  error?: string;
}

// ─── DB HELPERS ────────────────────────────────────────────────────────────

export const createToolCall = mutation({
  args: {
    projectId: v.id("projects"),
    missionId: v.string(),
    agentId: v.string(),
    agentName: v.string(),
    tool: v.string(),
    args: v.string(), // JSON
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
  },
  returns: v.id("toolCalls"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("toolCalls", { ...args, timestamp: Date.now() });
  },
});

export const updateToolCall = mutation({
  args: {
    toolCallId: v.id("toolCalls"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      finishedAt: Date.now(),
    };
    if (args.result !== undefined) patch.result = args.result;
    if (args.error !== undefined) patch.error = args.error;
    await ctx.db.patch(args.toolCallId, patch);
    return null;
  },
});

export const listToolCalls = query({
  args: {
    projectId: v.id("projects"),
    missionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let calls = await ctx.db
      .query("toolCalls")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("asc")
      .take(args.limit ?? 200);
    if (args.missionId) {
      calls = calls.filter(c => c.missionId === args.missionId);
    }
    return calls;
  },
});

export const clearToolCalls = mutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const calls = await ctx.db
      .query("toolCalls")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();
    for (const c of calls) await ctx.db.delete(c._id);
    return null;
  },
});

// ─── PLAN LIMITS ───────────────────────────────────────────────────────────

interface PlanLimits {
  maxSpawnDepth: number;
  maxSpawnsPerMission: number;
  maxConcurrentAgents: number;
  hardCapUsdMonthly: number;
  cappedOut: boolean;
  plan: string;
}

// ─── TOOL EXECUTOR ─────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  css: "css",
  html: "html",
  json: "json",
  md: "markdown",
  py: "python",
  sh: "shell",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
};

async function executeTool(
  ctx: any,
  projectId: Id<"projects">,
  missionId: string,
  agentId: string,
  agentName: string,
  call: ToolCall,
  spawnDepth: number,
  spawnCount: { value: number },
  _model: string,
  planLimits?: PlanLimits,
): Promise<ToolResult> {
  const toolCallId = await ctx.runMutation(api.engine.createToolCall, {
    projectId,
    missionId,
    agentId,
    agentName,
    tool: call.tool,
    args: JSON.stringify(call.args),
    status: "running",
  });

  try {
    // ── Sentry check ──────────────────────────────────────────────────────
    const sentryResult = await ctx.runAction(api.sentry.checkToolCall, {
      projectId,
      agentId,
      agentRole: agentName,
      tool: call.tool,
      toolArgs: JSON.stringify(call.args),
      spawnDepth,
    });

    if (!sentryResult.allowed) {
      await ctx.runMutation(api.engine.updateToolCall, {
        toolCallId,
        status: "error",
        error: `Sentry blocked: ${sentryResult.reason}`,
      });
      return {
        tool: call.tool,
        success: false,
        output: "",
        error: `Sentry blocked: ${sentryResult.reason}`,
      };
    }

    // If debate required (sensitive path/dangerous content), run it first
    if (sentryResult.requiresDebate && call.tool !== "complete_task") {
      const debateCheck = await ctx.runAction(api.debate.requireDebate, {
        projectId,
        proposal: `${call.tool}: ${JSON.stringify(call.args).slice(0, 200)}`,
        operationType: call.tool === "delete_file" ? "destructive" : "feature",
      });
      if (!debateCheck.allowed) {
        await ctx.runMutation(api.engine.updateToolCall, {
          toolCallId,
          status: "error",
          error: debateCheck.message,
        });
        return {
          tool: call.tool,
          success: false,
          output: "",
          error: debateCheck.message,
        };
      }
    }

    let output = "";

    switch (call.tool) {
      case "create_file": {
        const { path, content } = call.args as {
          path: string;
          content: string;
        };
        const ext = path.split(".").pop() ?? "";
        const existing = await ctx.runQuery(api.files.getByPath, {
          projectId,
          path,
        });
        if (existing) {
          await ctx.runMutation(api.files.update, {
            fileId: existing._id,
            content,
          });
          output = `Updated ${path} (${content.length} chars)`;
        } else {
          const parts = path.split("/");
          await ctx.runMutation(api.files.create, {
            projectId,
            path,
            name: parts[parts.length - 1]!,
            content,
            language: LANG_MAP[ext] ?? "plaintext",
            isDirectory: false,
            parentPath: parts.slice(0, -1).join("/") || undefined,
          });
          output = `Created ${path} (${content.length} chars)`;
        }
        break;
      }

      case "edit_file": {
        const { path, content } = call.args as {
          path: string;
          content: string;
        };
        const existing = await ctx.runQuery(api.files.getByPath, {
          projectId,
          path,
        });
        if (!existing) throw new Error(`File not found: ${path}`);
        await ctx.runMutation(api.files.update, {
          fileId: existing._id,
          content,
        });
        output = `Edited ${path} (${content.length} chars)`;
        break;
      }

      case "delete_file": {
        const { path } = call.args as { path: string };
        // Destructive ops require debate approval
        const debateCheck = await ctx.runAction(api.debate.requireDebate, {
          projectId,
          proposal: `Delete file: ${path}`,
          operationType: "destructive",
        });
        if (!debateCheck.allowed) {
          output = debateCheck.message;
          break;
        }
        const existing = await ctx.runQuery(api.files.getByPath, {
          projectId,
          path,
        });
        if (existing) {
          await ctx.runMutation(api.files.remove, { fileId: existing._id });
          output = `Deleted ${path}`;
        } else {
          output = `File not found (already deleted?): ${path}`;
        }
        break;
      }

      case "read_file": {
        const { path } = call.args as { path: string };
        const file = await ctx.runQuery(api.files.getByPath, {
          projectId,
          path,
        });
        if (!file) throw new Error(`File not found: ${path}`);
        output = file.content;
        break;
      }

      case "list_files": {
        const files = await ctx.runQuery(api.files.listByProject, {
          projectId,
        });
        output = files
          .filter((f: any) => !f.isDirectory)
          .map((f: any) => f.path)
          .join("\n");
        if (!output) output = "(no files yet)";
        break;
      }

      case "search_files": {
        const { query: searchQuery } = call.args as { query: string };
        const results = await ctx.runAction(api.rag.search, {
          projectId,
          query: searchQuery,
          topK: 10,
        });

        output =
          results.length > 0
            ? results
                .map(
                  (r: any) =>
                    `${r.path} (score: ${r.score.toFixed(1)}):\n${r.snippet}\n`,
                )
                .join("\n")
            : "No matches found";
        break;
      }

      case "get_context": {
        const { query: contextQuery } = call.args as { query: string };
        output = await ctx.runAction(api.rag.getContextForPrompt, {
          projectId,
          query: contextQuery,
          maxTokens: 2000,
        });
        break;
      }

      case "web_search": {
        const { query: searchQuery } = call.args as { query: string };
        output = await ctx.runAction(api.webSearch.searchForAgent, {
          query: searchQuery,
          agentRole: agentName.toLowerCase(),
          maxResults: 4,
        });
        if (!output) output = "No web search results found.";
        break;
      }

      case "spawn_agent": {
        const maxDepth = planLimits?.maxSpawnDepth ?? 3;
        const maxSpawns = planLimits?.maxSpawnsPerMission ?? 25;

        if (spawnDepth >= maxDepth) {
          output = `⚠️ Spawn depth limit (${maxDepth}) reached`;
          break;
        }
        if (spawnCount.value >= maxSpawns) {
          output = `⚠️ Mission spawn limit (${maxSpawns}) reached`;
          break;
        }

        spawnCount.value++;
        const { role, task } = call.args as { role: string; task: string };
        const childModel = await getModelForRole(ctx, role);

        await ctx.runMutation(api.agentThoughts.emit, {
          projectId,
          agentId,
          agentName,
          type: "broadcast",
          content: `Spawning ${role} agent: ${task}`,
          isStreaming: false,
        });

        const childResult = await runAgentLoop(
          ctx,
          projectId,
          missionId,
          role,
          role,
          task,
          spawnDepth + 1,
          spawnCount,
          childModel,
          planLimits,
        );
        output = `Agent ${role} completed: ${childResult.slice(0, 300)}`;
        break;
      }

      case "send_message": {
        const { to, message } = call.args as { to: string; message: string };
        await ctx.runMutation(api.memory.postAgentMessage, {
          projectId,
          fromAgentId: agentId,
          fromAgentName: agentName,
          fromAgentIcon: "🤖",
          messageType: "context",
          content: `→ ${to}: ${message}`,
        });
        output = `Message sent to ${to}`;
        break;
      }

      case "deploy_project": {
        try {
          await ctx.runMutation(api.agentThoughts.emit, {
            projectId,
            agentId,
            agentName,
            type: "broadcast",
            content: `🚀 Triggering Vercel deployment...`,
            isStreaming: false,
          });
          const result = await ctx.runAction(api.deployVercel.deploy, {
            projectId,
          });
          output = `Successfully deployed project to Vercel! URL: ${result.url} (ID: ${result.deploymentId})`;
        } catch (e: any) {
          output = `Deployment failed: ${e.message}`;
        }
        break;
      }

      case "complete_task": {
        const { summary } = call.args as { summary: string };
        output = summary;
        break;
      }

      default:
        throw new Error(`Unknown tool: ${(call as any).tool}`);
    }

    await ctx.runMutation(api.engine.updateToolCall, {
      toolCallId,
      status: "done",
      result: output.slice(0, 2000),
    });
    return { tool: call.tool, success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(api.engine.updateToolCall, {
      toolCallId,
      status: "error",
      error,
    });
    return { tool: call.tool, success: false, output: "", error };
  }
}

// ─── AGENT LOOP ────────────────────────────────────────────────────────────
// think → act → observe → repeat
// - Tight, action-forcing prompts with concrete JSON examples
// - Progress detection: 2 turns with no file writes → force decision
// - Context window: only last 3 turns in history
// - Stall detection: repeated tool call → skip, force complete_task
// - MAX_TURNS = 8

async function runAgentLoop(
  ctx: any,
  projectId: Id<"projects">,
  missionId: string,
  agentId: string,
  agentName: string,
  task: string,
  depth: number,
  spawnCount: { value: number },
  model: string,
  planLimits?: PlanLimits,
  byok?: { callerPlan: string; userKeys?: Record<string, string> },
): Promise<string> {
  const files = await ctx.runQuery(api.files.listByProject, { projectId });
  const codeFiles = files.filter((f: any) => !f.isDirectory);
  const fileList =
    codeFiles.map((f: any) => `  ${f.path}`).join("\n") || "  (empty project)";

  const role = agentName.toLowerCase();
  let roleSpecificPrompt = "";
  if (role === "orchestrator" || role === "lead architect") {
    roleSpecificPrompt =
      "You are the Lead Architect. Break down complex requests and spawn specialized agents using the `spawn_agent` tool. Coordinate their work and consolidate the final result.";
  } else if (role === "frontend") {
    roleSpecificPrompt =
      "You are a specialized Frontend Engineer. Focus on UI/UX, React components, Tailwind CSS, and frontend functionality. Write elegant, responsive code.";
  } else if (role === "backend") {
    roleSpecificPrompt =
      "You are a specialized Backend Engineer. Focus on Convex schemas, queries, mutations, actions, and overall data integrity and API design.";
  } else if (role === "devops") {
    roleSpecificPrompt =
      "You are a DevOps Engineer. Focus on builds, deployments, configs, and CI/CD. Use the deploy_project tool when deployment is requested.";
  } else {
    roleSpecificPrompt = `You are ${agentName}, an expert software engineer agent inside CodeForge.`;
  }

  const SYSTEM_PROMPT = `${roleSpecificPrompt} You are part of the world's best autonomous coding platform.

Your task: ${task}

Current project files:
${fileList}

You MUST respond with a JSON object containing ONE tool call to make progress. No explanations outside the JSON.

Available tools:
- create_file: { "tool": "create_file", "args": { "path": "src/foo.ts", "content": "..." } }
- edit_file:   { "tool": "edit_file",   "args": { "path": "src/foo.ts", "content": "..." } }
- delete_file: { "tool": "delete_file", "args": { "path": "src/foo.ts" } }
- read_file:   { "tool": "read_file",   "args": { "path": "src/foo.ts" } }
- list_files:  { "tool": "list_files",  "args": {} }
- search_files:{ "tool": "search_files","args": { "query": "search term" } }
- get_context: { "tool": "get_context", "args": { "query": "search term" } }
- web_search:  { "tool": "web_search",  "args": { "query": "how to implement X in React 2026" } }
- spawn_agent: { "tool": "spawn_agent", "args": { "role": "coder", "task": "implement X" } }
- send_message:{ "tool": "send_message","args": { "to": "orchestrator", "message": "done with X" } }
- deploy_project:{ "tool": "deploy_project", "args": {} }
- complete_task:{"tool": "complete_task","args": { "summary": "What I accomplished" } }

Rules:
1. Always output ONLY valid JSON. Nothing else.
2. Write COMPLETE file content — never truncate with "// ...rest".
3. When done with all changes, call complete_task.
4. If you need to read a file before editing, call read_file first.
5. Spawn specialist agents for distinct sub-tasks.`;

  const conversationHistory: { role: "user" | "assistant"; content: string }[] =
    [];
  const MAX_TURNS = 8;
  let fileWriteCount = 0;
  let turnsWithoutWrite = 0;
  let lastToolCallKey = "";
  let finalSummary = `${agentName} completed: ${task}`;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Build the user message for this turn
    const turnMsg =
      conversationHistory.length === 0
        ? `Begin your task. Respond with your first tool call as JSON.`
        : `Tool result received. Continue with your next tool call, or call complete_task if done.`;

    const messages: {
      role: "system" | "user" | "assistant";
      content: string;
    }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      // Keep only last 3 turns to avoid context overflow
      ...conversationHistory.slice(-6),
      { role: "user", content: turnMsg },
    ];

    // Emit thought
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId,
      agentId,
      agentName,
      type: "thinking",
      content: `Turn ${turn + 1}/${MAX_TURNS}: ${task.slice(0, 80)}…`,
      isStreaming: false,
    });

    let rawResponse: string | null = null;
    let aiRetries = 0;
    while (aiRetries < 3) {
      try {
        const { text, modelUsed } = await callAIWithFallback(messages, {
          model,
          callerPlan: byok?.callerPlan,
          userKeys: byok?.userKeys,
        });
        rawResponse = text;

        await ctx.runMutation(api.agentThoughts.emit, {
          projectId,
          agentId,
          agentName,
          type: "action",
          content: `[${modelUsed}] ${rawResponse.slice(0, 150)}`,
          isStreaming: false,
        });
        break;
      } catch (err) {
        aiRetries++;
        const errMsg = err instanceof Error ? err.message : String(err);
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId,
          agentId,
          agentName,
          type: "error",
          content: `AI error (attempt ${aiRetries}/3): ${errMsg}`,
          isStreaming: false,
        });

        if (
          aiRetries >= 3 ||
          errMsg.includes("API key is invalid") ||
          errMsg.includes("Add one in Settings")
        ) {
          break; // Stop retrying on hard failures or max retries
        }

        // Wait briefly before retrying
        await new Promise(r => setTimeout(r, 2000 * aiRetries));
      }
    }

    if (!rawResponse) {
      break; // Abort loop if AI permanently failed
    }

    // Parse the tool call from JSON response
    let toolCall: ToolCall | null = null;
    try {
      // Extract JSON from response (may have markdown fences)
      const jsonMatch =
        rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ??
        rawResponse.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawResponse.trim();
      const parsed = JSON.parse(jsonStr!);
      if (parsed.tool && parsed.args !== undefined) {
        toolCall = parsed as ToolCall;
      }
    } catch {
      // If JSON parse fails, try to extract tool name from text
      const toolMatch = rawResponse.match(/"tool"\s*:\s*"([^"]+)"/);
      if (!toolMatch) {
        conversationHistory.push({ role: "assistant", content: rawResponse });
        conversationHistory.push({
          role: "user",
          content:
            "Your response was not valid JSON. Respond ONLY with a JSON tool call object.",
        });
        continue;
      }
    }

    if (!toolCall) continue;

    // Stall detection: same tool + same args twice in a row → force complete
    const toolKey = `${toolCall.tool}:${JSON.stringify(toolCall.args)}`;
    if (toolKey === lastToolCallKey) {
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId,
        agentId,
        agentName,
        type: "warning",
        content: "Repeated tool call detected — forcing task completion.",
        isStreaming: false,
      });
      break;
    }
    lastToolCallKey = toolKey;

    // complete_task → we're done
    if (toolCall.tool === "complete_task") {
      finalSummary = (toolCall.args as any).summary ?? finalSummary;
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId,
        agentId,
        agentName,
        type: "done",
        content: finalSummary,
        isStreaming: false,
      });
      break;
    }

    // Execute the tool
    const result = await executeTool(
      ctx,
      projectId,
      missionId,
      agentId,
      agentName,
      toolCall,
      depth,
      spawnCount,
      model,
      planLimits,
    );

    // Track progress
    if (toolCall.tool === "create_file" || toolCall.tool === "edit_file") {
      fileWriteCount++;
      turnsWithoutWrite = 0;
    } else {
      turnsWithoutWrite++;
    }

    // Add to conversation history
    conversationHistory.push({
      role: "assistant",
      content: JSON.stringify(toolCall),
    });
    conversationHistory.push({
      role: "user",
      content: result.success
        ? `Tool result: ${result.output.slice(0, 800)}`
        : `Tool error: ${result.error}. Try a different approach.`,
    });

    // Force progress if stalling (2 turns of reads/searches with no writes)
    if (turnsWithoutWrite >= 2 && fileWriteCount === 0) {
      conversationHistory.push({
        role: "user",
        content:
          "You've been reading/searching without writing any files. " +
          "Make a concrete file change now, or call complete_task if nothing is needed.",
      });
      turnsWithoutWrite = 0;
    }
  }

  return finalSummary;
}

// ─── PUBLIC ACTION: runMission ──────────────────────────────────────────────

export const runMission = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
    model: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const missionId = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const model = args.model ?? (await getModelForRole(ctx, "orchestrator"));
    const spawnCount = { value: 0 };

    // Fetch plan limits
    let planLimits: PlanLimits | undefined;
    try {
      const limitsData = await ctx.runQuery(api.limits.getMyLimits, {});
      if (limitsData) {
        planLimits = {
          maxSpawnDepth: limitsData.limits.maxSpawnDepth,
          maxSpawnsPerMission: limitsData.limits.maxSpawnsPerMission,
          maxConcurrentAgents: limitsData.limits.maxConcurrentAgents,
          hardCapUsdMonthly: limitsData.limits.hardCapUsdMonthly,
          cappedOut: false,
          plan: limitsData.plan,
        };
      }
    } catch {
      // Use generous defaults if limits query fails
      planLimits = {
        maxSpawnDepth: 3,
        maxSpawnsPerMission: 25,
        maxConcurrentAgents: 5,
        hardCapUsdMonthly: 10,
        cappedOut: false,
        plan: "free",
      };
    }

    // Resolve BYOK for this caller
    const userId = await ctx.runQuery(api.auth.currentUser, {});
    const byok = await resolveByok(
      ctx,
      userId?._id ? String(userId._id) : undefined,
    );

    const result = await runAgentLoop(
      ctx,
      args.projectId,
      missionId,
      "orchestrator",
      "Orchestrator",
      args.prompt,
      0,
      spawnCount,
      model,
      planLimits,
      byok,
    );

    // After mission completes, extract learnings asynchronously
    // (We don't await this so it doesn't block returning the final result)
    ctx.runAction(internal.autoLearn.extractLearnings, {
      projectId: args.projectId,
      missionId,
      goal: args.prompt,
      agentSequence: ["orchestrator"],
      filesChanged: [], // We could collect this from toolCalls if needed
      healCycles: 0,
      success: !result.toLowerCase().includes("failed"),
    }).catch(err => console.error("[engine] autoLearn failed:", err));

    return result;
  },
});
