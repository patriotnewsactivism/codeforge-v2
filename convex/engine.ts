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
import { MCP_MANIFEST, type AgentRole } from "./sentry";

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
  | "spawn_epic"
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
        output = await ctx.runAction(internal.webSearch.searchForAgent, {
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

      case "spawn_epic": {
        const { plan, goal } = call.args as { plan: string; goal: string };
        const result = await ctx.runAction(
          internal.spawnEngine.executeSpawnPlan,
          {
            projectId,
            missionId,
            plan: typeof plan === "string" ? plan : JSON.stringify(plan),
            goal,
          },
        );
        output = `Epic spawn completed. ${result.success ? "Success" : "Failed"}: ${result.shardsCompleted}/${result.totalShards} shards executed.`;
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
// - Progress detection: 3 turns with no file writes (after first write) → force decision
// - Context window: last 6 turns in history
// - Stall detection: repeated tool call → skip, force complete_task
// - MAX_TURNS = 15

/**
 * Robust JSON tool-call extractor. Tries multiple strategies to parse the
 * AI response into a valid ToolCall, since models often wrap JSON in
 * markdown fences, add explanatory text, or produce slightly malformed output.
 */
function extractToolCall(rawResponse: string): ToolCall | null {
  // Strategy 1: Direct parse (clean JSON response)
  try {
    const parsed = JSON.parse(rawResponse.trim());
    if (parsed.tool && parsed.args !== undefined) return parsed as ToolCall;
  } catch { /* continue */ }

  // Strategy 2: Extract from markdown code fences
  const fenceMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed.tool && parsed.args !== undefined) return parsed as ToolCall;
    } catch { /* continue */ }
  }

  // Strategy 3: Find the first {...} block that contains "tool"
  const jsonBlocks = rawResponse.match(/\{[\s\S]*?\}/g);
  if (jsonBlocks) {
    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (parsed.tool && parsed.args !== undefined) return parsed as ToolCall;
      } catch { /* continue */ }
    }
  }

  // Strategy 4: Find a deeply nested {...} that might span multiple lines
  const deepMatch = rawResponse.match(/(\{[\s\S]*\})/);
  if (deepMatch) {
    try {
      const parsed = JSON.parse(deepMatch[1]);
      if (parsed.tool && parsed.args !== undefined) return parsed as ToolCall;
    } catch { /* continue */ }
  }

  // Strategy 5: Partial extraction — find tool name and reconstruct
  const toolMatch = rawResponse.match(/"tool"\s*:\s*"([^"]+)"/);
  const argsMatch = rawResponse.match(/"args"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
  if (toolMatch && argsMatch) {
    try {
      const args = JSON.parse(argsMatch[1]);
      return { tool: toolMatch[1] as ToolName, args };
    } catch { /* continue */ }
  }

  return null;
}

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

  // Build file context: include ACTUAL file content for small projects,
  // paths + truncated content for larger ones
  let fileContext = "";
  if (codeFiles.length === 0) {
    fileContext = "  (empty project — no files yet)";
  } else if (codeFiles.length <= 15) {
    // Small project: include full content of all files
    fileContext = codeFiles
      .map((f: any) => {
        const content = f.content ?? "";
        // Cap individual files at 2000 chars to avoid context overflow
        const truncated =
          content.length <= 2000
            ? content
            : content.slice(0, 1500) + "\n\n// ... (truncated, use read_file to see full content)";
        return `--- ${f.path} ---\n${truncated}`;
      })
      .join("\n\n");
  } else {
    // Large project: paths + first 200 chars of each file
    fileContext = codeFiles
      .map((f: any) => {
        const preview = (f.content ?? "").slice(0, 200);
        return `--- ${f.path} ---\n${preview}${(f.content ?? "").length > 200 ? "\n// ..." : ""}`;
      })
      .join("\n\n");
  }

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
${fileContext}

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
- spawn_epic:  { "tool": "spawn_epic",  "args": { "goal": "epic goal", "plan": "{"shards": [...]}" } }
- send_message:{ "tool": "send_message","args": { "to": "orchestrator", "message": "done with X" } }
- deploy_project:{ "tool": "deploy_project", "args": {} }
- complete_task:{"tool": "complete_task","args": { "summary": "What I accomplished" } }

Rules:
1. Always output ONLY valid JSON. Nothing else.
2. Write COMPLETE file content — never truncate with "// ...rest".
3. When done with all changes, call complete_task.
4. You already have file contents above — start writing code immediately unless you need to read a specific large file.
5. Spawn specialist agents for distinct sub-tasks.
6. For multi-file changes, create/edit files one at a time.`;

  const conversationHistory: { role: "user" | "assistant"; content: string }[] =
    [];
  const MAX_TURNS = 15;
  let fileWriteCount = 0;
  let turnsWithoutWrite = 0;
  let lastToolCallKey = "";
  let consecutiveParseFailures = 0;
  let finalSummary = `${agentName} completed: ${task}`;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Build the user message for this turn
    const turnMsg =
      conversationHistory.length === 0
        ? `Begin your task. You have the file contents above — start making changes immediately. Respond with your first tool call as JSON.`
        : `Tool result received. Continue with your next tool call, or call complete_task if done.`;

    const messages: {
      role: "system" | "user" | "assistant";
      content: string;
    }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      // Keep last 6 turns (12 messages) for context — doubled from previous 3
      ...conversationHistory.slice(-12),
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

    // Parse the tool call using the robust extractor
    const toolCall = extractToolCall(rawResponse);

    if (!toolCall) {
      consecutiveParseFailures++;
      conversationHistory.push({ role: "assistant", content: rawResponse });

      if (consecutiveParseFailures >= 3) {
        // After 3 consecutive parse failures, force-complete
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId,
          agentId,
          agentName,
          type: "warning",
          content: "3 consecutive parse failures — forcing task completion.",
          isStreaming: false,
        });
        break;
      }

      conversationHistory.push({
        role: "user",
        content:
          "Your response was not valid JSON. You MUST respond with ONLY a JSON object like: {\"tool\": \"create_file\", \"args\": {\"path\": \"file.txt\", \"content\": \"...\"}}. No other text.",
      });
      continue;
    }

    // Reset parse failure counter on success
    consecutiveParseFailures = 0;

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

    // Track progress — only count as a real write if the tool call actually
    // succeeded. A Sentry-blocked or errored edit_file/create_file call must
    // NOT count as progress, or the stall-detector (and callers checking
    // fileWriteCount) will believe work happened when nothing was written.
    if (
      (toolCall.tool === "create_file" || toolCall.tool === "edit_file") &&
      result.success
    ) {
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
        ? `Tool result: ${result.output.slice(0, 1200)}`
        : result.error?.startsWith("Sentry blocked")
          ? `${result.error}. Your role cannot edit files directly — use ` +
            `the \`spawn_agent\` tool to delegate this file change to a ` +
            `"coder" or "debugger" agent instead. Do not retry edit_file/create_file yourself.`
          : `Tool error: ${result.error}. Try a different approach.`,
    });

    // Force progress if stalling — but only AFTER the agent has already written
    // at least one file. Allow exploratory reads at the start of a mission.
    if (turnsWithoutWrite >= 3 && fileWriteCount > 0) {
      conversationHistory.push({
        role: "user",
        content:
          "You've been reading/searching without writing any files for 3 turns. " +
          "Make a concrete file change now, or call complete_task if the work is done.",
      });
      turnsWithoutWrite = 0;
    } else if (turnsWithoutWrite >= 4 && fileWriteCount === 0) {
      // Even for exploration, 4 turns without any writes is too long
      conversationHistory.push({
        role: "user",
        content:
          "You have explored the codebase for several turns without making any changes. " +
          "Start writing code now, or call complete_task if nothing needs to be done.",
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
    ctx
      .runAction(internal.autoLearn.extractLearnings, {
        projectId: args.projectId,
        missionId,
        goal: args.prompt,
        agentSequence: ["orchestrator"],
        filesChanged: [], // We could collect this from toolCalls if needed
        healCycles: 0,
        success: !result.toLowerCase().includes("failed"),
      })
      .catch(err => console.error("[engine] autoLearn failed:", err));

    return result;
  },
});

// ─── PUBLIC ACTION: executeWorkItem ──────────────────────────────────────────

export const executeWorkItem = action({
  args: {
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch the work item
    const workItem = await ctx.runQuery(api.planner.getWorkItem, {
      workItemId: args.workItemId,
    });
    if (!workItem) throw new Error("Work item not found");

    // 2. Select appropriate agent role based on category
    let agentRole = "coder";
    if (workItem.category === "security") agentRole = "forensic";
    else if (
      workItem.category === "infrastructure" ||
      workItem.category === "ci" ||
      workItem.category === "deploy"
    )
      agentRole = "devops";
    else if (workItem.category === "testing") agentRole = "tester";

    const prompt = `[WORK ITEM: ${workItem.title}]\n\nCategory: ${workItem.category}\nPriority: ${workItem.priority}\n\nDetails:\n${workItem.description}\n\nReview the project files and implement the necessary changes to complete this task.`;

    // Resolve BYOK
    const userId = await ctx.runQuery(api.auth.currentUser, {});
    const byok = await resolveByok(
      ctx,
      userId?._id ? String(userId._id) : undefined,
    );

    let currentPrompt = prompt;
    let finalResult = "";
    const MAX_ITERATIONS = 3;

    // Fetch limits once
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
      planLimits = {
        maxSpawnDepth: 3,
        maxSpawnsPerMission: 25,
        maxConcurrentAgents: 5,
        hardCapUsdMonthly: 10,
        cappedOut: false,
        plan: "free",
      };
    }

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      const missionId = `mission_${args.workItemId}_iter_${iteration}`;
      const spawnCount = { value: 0 };
      
      // Adaptive Scaling: On retry, escalate to "architect" tier to solve harder problems
      // and bump the spawn limits.
      const isRetry = iteration > 1;
      const effectiveRole = isRetry ? "architect" : agentRole;
      const model = await getModelForRole(ctx, effectiveRole as any);

      if (isRetry && planLimits) {
        planLimits.maxSpawnsPerMission = Math.min(50, planLimits.maxSpawnsPerMission + 10);
        planLimits.maxSpawnDepth = Math.min(5, planLimits.maxSpawnDepth + 1);
      }

      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "acse-executor",
        agentName: "ACSE Executor",
        type: "plan",
        content: `▶️ Iteration ${iteration}/${MAX_ITERATIONS} for Work Item: ${workItem.title}`,
        isStreaming: false,
      });

      // 3. Run the agent loop
      finalResult = await runAgentLoop(
        ctx,
        args.projectId,
        missionId,
        agentRole,
        agentRole.charAt(0).toUpperCase() + agentRole.slice(1),
        currentPrompt,
        0,
        spawnCount,
        model,
        planLimits,
        byok,
      );

      // 4. Determine what files were changed
      const toolCalls = await ctx.runQuery(api.engine.listToolCalls, {
        projectId: args.projectId,
        missionId,
        limit: 100,
      });

      const filesChanged = new Set<string>();
      for (const call of toolCalls) {
        // Only count calls that actually completed — a Sentry-blocked or
        // otherwise errored edit_file/create_file call never touched the
        // file, so it must not be treated as a real change. Previously this
        // counted the call just from its tool name regardless of status,
        // which let blocked edits still trigger a code review and let a
        // work item close as "done" on changes that never happened.
        if (
          (call.tool === "edit_file" || call.tool === "create_file") &&
          call.status !== "error"
        ) {
          try {
            const parsedArgs = JSON.parse(call.args);
            if (parsedArgs.path) filesChanged.add(parsedArgs.path);
          } catch {
            // Ignore parse errors
          }
        }
      }

      if (filesChanged.size === 0) {
        // No files changed, just assume done or no work needed
        await ctx.runMutation(api.planner.updateWorkItemStatus, {
          workItemId: args.workItemId,
          status: "done",
          result: finalResult,
        });
        return finalResult;
      }

      // 5. Trigger code review
      const reviewPayloadStr = await ctx.runAction(
        api.codeReview.reviewChanges,
        {
          projectId: args.projectId,
          filePaths: Array.from(filesChanged),
          workItemId: args.workItemId,
          context: workItem.title,
        },
      );

      // Parse review payload string: { reviewId, consensus, totalFindings }
      let consensus = "approved";
      let reviewId = "";
      try {
        const payload = JSON.parse(reviewPayloadStr);
        consensus = payload.consensus;
        reviewId = payload.reviewId;
      } catch {
        // fallback
      }

      if (consensus === "approved") {
        await ctx.runMutation(api.planner.updateWorkItemStatus, {
          workItemId: args.workItemId,
          status: "done",
          result: finalResult,
        });
        return finalResult;
      } else {
        if (iteration === MAX_ITERATIONS) {
          await ctx.runMutation(api.planner.updateWorkItemStatus, {
            workItemId: args.workItemId,
            status: "skipped",
            result: `Failed code review after ${MAX_ITERATIONS} iterations.`,
          });
          return "Execution failed code review permanently.";
        }

        // 6. Gather findings and update prompt for next iteration
        const reviewRecord = await ctx.runQuery(api.codeReview.getReview, {
          reviewId: reviewId as Id<"codeReviews">,
        });

        let findingsStr = "";
        if (reviewRecord?.reviewers) {
          const reviewersArr = JSON.parse(reviewRecord.reviewers);
          for (const rev of reviewersArr) {
            if (rev.verdict !== "approve" && rev.findings.length > 0) {
              findingsStr += `\nReviewer [${rev.role}]:\n`;
              for (const f of rev.findings) {
                findingsStr += `- [${f.severity}] ${f.file}: ${f.message}\n`;
              }
            }
          }
        }

        currentPrompt = `[CODE REVIEW FAILED]\nYour previous attempt failed code review. Please fix the following findings:\n${findingsStr}\n\nOriginal Task Context:\n${prompt}`;

        await ctx.runMutation(api.agentThoughts.emit, {
          projectId: args.projectId,
          agentId: "acse-executor",
          agentName: "ACSE Executor",
          type: "warning",
          content: `⚠️ Work item failed review. Findings:\n${findingsStr}\nRestarting iteration...`,
          isStreaming: false,
        });
      }
    }

    return finalResult;
  },
});
