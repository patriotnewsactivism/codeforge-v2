/**
 * engine.ts — CodeForge v2 Agentic Tool-Calling Loop
 *
 * Instead of AI writing markdown parsed with regex, agents use structured tool calls:
 *   Agent calls AI → AI returns { tool_calls: [...] } → Tools execute → Results → AI continues
 *
 * Tools: create_file, edit_file, delete_file, read_file, list_files,
 *        search_files, spawn_agent, send_message, complete_task
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };
const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

// ─── TOOL CALL SCHEMA ────────────────────────────────────────────────────────

export type ToolName =
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "read_file"
  | "list_files"
  | "search_files"
  | "spawn_agent"
  | "send_message"
  | "complete_task";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, string | number | boolean>;
}

export interface ToolResult {
  tool: ToolName;
  success: boolean;
  output: string;
  error?: string;
}

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

// toolCalls table mutations
export const createToolCall = mutation({
  args: {
    projectId: v.id("projects"),
    missionId: v.string(),
    agentId: v.string(),
    agentName: v.string(),
    tool: v.string(),
    args: v.string(), // JSON
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("error")),
  },
  returns: v.id("toolCalls"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("toolCalls", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const updateToolCall = mutation({
  args: {
    toolCallId: v.id("toolCalls"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("error")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.result !== undefined) patch.result = args.result;
    if (args.error !== undefined) patch.error = args.error;
    patch.finishedAt = Date.now();
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
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("asc")
      .take(args.limit ?? 200);
    if (args.missionId) {
      calls = calls.filter((c) => c.missionId === args.missionId);
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
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of calls) await ctx.db.delete(c._id);
    return null;
  },
});

// ─── AI CALL ─────────────────────────────────────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  const res = await fetch(`${VIKTOR_API_URL}/api/viktor-spaces/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: PROJECT_NAME,
      project_secret: PROJECT_SECRET,
      role: "quick_ai_search",
      arguments: { search_question: prompt },
    }),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
  const json = await res.json() as { success: boolean; error?: string; result?: { search_response: string } };
  if (!json.success) throw new Error(json.error ?? "AI call failed");
  return json.result?.search_response ?? "";
}

// ─── TOOL EXECUTION ──────────────────────────────────────────────────────────

async function executeTool(
  ctx: any,
  projectId: Id<"projects">,
  missionId: string,
  agentId: string,
  agentName: string,
  call: ToolCall,
  spawnDepth: number,
  spawnCount: { value: number }
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
    let output = "";

    switch (call.tool) {
      case "create_file": {
        const { path, content } = call.args as { path: string; content: string };
        const ext = path.split(".").pop() ?? "";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescriptreact", js: "javascript",
          jsx: "javascriptreact", css: "css", html: "html",
          json: "json", md: "markdown", py: "python",
        };
        const existing = await ctx.runQuery(api.files.getByPath, { projectId, path });
        if (existing) {
          await ctx.runMutation(api.files.update, { fileId: existing._id, content });
          output = `Updated ${path} (${content.length} chars)`;
        } else {
          const parts = path.split("/");
          await ctx.runMutation(api.files.create, {
            projectId, path,
            name: parts[parts.length - 1]!,
            content,
            language: langMap[ext] ?? "plaintext",
            isDirectory: false,
            parentPath: parts.slice(0, -1).join("/") || undefined,
          });
          output = `Created ${path} (${content.length} chars)`;
        }
        break;
      }

      case "edit_file": {
        const { path, content } = call.args as { path: string; content: string };
        const existing = await ctx.runQuery(api.files.getByPath, { projectId, path });
        if (!existing) {
          throw new Error(`File not found: ${path}`);
        }
        await ctx.runMutation(api.files.update, { fileId: existing._id, content });
        output = `Edited ${path} (${content.length} chars)`;
        break;
      }

      case "delete_file": {
        const { path } = call.args as { path: string };
        const existing = await ctx.runQuery(api.files.getByPath, { projectId, path });
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
        const file = await ctx.runQuery(api.files.getByPath, { projectId, path });
        if (!file) throw new Error(`File not found: ${path}`);
        output = file.content;
        break;
      }

      case "list_files": {
        const files = await ctx.runQuery(api.files.listByProject, { projectId });
        output = files.filter(f => !f.isDirectory).map(f => f.path).join("\n");
        break;
      }

      case "search_files": {
        const { query: searchQuery } = call.args as { query: string };
        const files = await ctx.runQuery(api.files.listByProject, { projectId });
        const q = searchQuery.toLowerCase();
        const matches = files.filter(f =>
          !f.isDirectory && (f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q))
        );
        output = matches.slice(0, 10).map(f =>
          `${f.path}: ${f.content.substring(0, 200).replace(/\n/g, " ")}…`
        ).join("\n\n");
        if (!output) output = "No matches found";
        break;
      }

      case "spawn_agent": {
        const MAX_DEPTH = 4;
        const MAX_SPAWNS = 25;
        if (spawnDepth >= MAX_DEPTH) {
          output = `Spawn depth limit (${MAX_DEPTH}) reached`;
          break;
        }
        if (spawnCount.value >= MAX_SPAWNS) {
          output = `Spawn limit (${MAX_SPAWNS}) reached`;
          break;
        }
        spawnCount.value++;
        const { role, task } = call.args as { role: string; task: string };
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId,
          agentId,
          agentName,
          type: "broadcast",
          content: `Spawning ${role} agent: ${task}`,
          isStreaming: false,
        });
        const childResult = await runAgentLoop(
          ctx, projectId, missionId, role, role,
          task, spawnDepth + 1, spawnCount
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

// ─── AGENT LOOP (think → act → observe → repeat) ─────────────────────────────

async function runAgentLoop(
  ctx: any,
  projectId: Id<"projects">,
  missionId: string,
  agentId: string,
  agentName: string,
  task: string,
  depth: number,
  spawnCount: { value: number }
): Promise<string> {

  // Load context
  const files = await ctx.runQuery(api.files.listByProject, { projectId });
  const codeFiles = files.filter((f: any) => !f.isDirectory);
  const fileList = codeFiles.map((f: any) => f.path).join(", ");

  const systemPrompt = `You are ${agentName}, an autonomous coding agent in CodeForge v2.

You solve tasks by calling tools in a loop:
1. THINK about what to do
2. CALL a tool
3. OBSERVE the result
4. Repeat until the task is done, then call complete_task

AVAILABLE TOOLS:
- create_file(path, content): Create or overwrite a file with COMPLETE content
- edit_file(path, content): Edit an existing file with COMPLETE new content  
- delete_file(path): Delete a file
- read_file(path): Read a file's content
- list_files(): List all project files
- search_files(query): Search file contents
- spawn_agent(role, task): Spawn a specialist child agent
- send_message(to, message): Send a message to another agent
- complete_task(summary): Mark the task done and return a summary

RULES:
- Always write COMPLETE file contents — never partial diffs
- Call complete_task when done
- Max 12 tool calls per loop
- Each tool call must make real progress

PROJECT FILES: ${fileList}

RESPOND ONLY with valid JSON — no prose, no markdown:
{
  "thought": "what you plan to do next and why",
  "tool_calls": [
    { "tool": "create_file", "args": { "path": "src/App.tsx", "content": "..." } }
  ]
}

When done, the last tool_calls array must include complete_task.`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `TASK: ${task}` },
  ];

  let finalSummary = "Task completed";
  const MAX_TURNS = 12;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId,
      agentId,
      agentName,
      type: turn === 0 ? "analyze" : "code",
      content: turn === 0 ? `Starting: ${task}` : `Turn ${turn + 1}/${MAX_TURNS}`,
      isStreaming: true,
    });

    // Build prompt from message history
    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    let rawResponse = "";
    try {
      rawResponse = await callAI(conversationText);
    } catch (err) {
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId, agentId, agentName, type: "debug",
        content: `AI call failed: ${err instanceof Error ? err.message : String(err)}`,
        isStreaming: false,
      });
      break;
    }

    // Parse response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // AI returned plain text — treat as complete_task
      finalSummary = rawResponse.slice(0, 500);
      break;
    }

    let parsed: { thought?: string; tool_calls?: ToolCall[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      finalSummary = rawResponse.slice(0, 500);
      break;
    }

    if (parsed.thought) {
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId, agentId, agentName, type: "plan",
        content: parsed.thought,
        isStreaming: false,
      });
    }

    const toolCalls = parsed.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalSummary = parsed.thought ?? "No actions taken";
      break;
    }

    // Execute tools
    const toolResults: ToolResult[] = [];
    let isDone = false;

    for (const call of toolCalls) {
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId, agentId, agentName,
        type: call.tool.includes("file") ? "code" : "broadcast",
        content: `→ ${call.tool}(${Object.keys(call.args).map(k =>
          k === "content" ? `${k}: [${String(call.args[k]).length} chars]` : `${k}: ${String(call.args[k]).slice(0, 60)}`
        ).join(", ")})`,
        isStreaming: false,
      });

      const result = await executeTool(
        ctx, projectId, missionId, agentId, agentName,
        call, depth, spawnCount
      );
      toolResults.push(result);

      if (call.tool === "complete_task") {
        finalSummary = result.output || "Task completed";
        isDone = true;
        break;
      }
    }

    if (isDone) break;

    // Add results to conversation for next turn
    const resultsText = toolResults.map(r =>
      `${r.tool}: ${r.success ? r.output.slice(0, 500) : `ERROR: ${r.error}`}`
    ).join("\n\n");

    messages.push({ role: "assistant", content: jsonMatch[0] });
    messages.push({ role: "user", content: `TOOL RESULTS:\n${resultsText}\n\nContinue or call complete_task if done.` });
  }

  await ctx.runMutation(api.agentThoughts.emit, {
    projectId, agentId, agentName, type: "done",
    content: finalSummary.slice(0, 300),
    isStreaming: false,
  });

  return finalSummary;
}

// ─── PUBLIC ACTION: RUN MISSION ───────────────────────────────────────────────

export const runMission = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
    sessionId: v.optional(v.id("chatSessions")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const missionId = `mission-${Date.now()}`;

    // Clear old thoughts
    await ctx.runMutation(api.agentThoughts.clearForProject, { projectId: args.projectId });
    await ctx.runMutation(api.engine.clearToolCalls, { projectId: args.projectId });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner",
      agentName: "Planner",
      type: "plan",
      content: `Mission received: "${args.prompt}"`,
      isStreaming: true,
    });

    // Load memory
    let memoryContext = "";
    try {
      memoryContext = await ctx.runAction(api.memory.getMemoriesForPrompt, {
        projectId: args.projectId, topN: 15,
      });
    } catch { /* non-fatal */ }

    // ── PLANNER: decide which agents to spawn ─────────────────────────────────
    const files = await ctx.runQuery(api.files.listByProject, { projectId: args.projectId });
    const fileList = files.filter(f => !f.isDirectory).map(f => f.path).join(", ");

    const planPrompt = `You are the Master Planner for CodeForge v2. Route tasks to specialist agents.

USER REQUEST: "${args.prompt}"
${memoryContext ? `MEMORY:\n${memoryContext}\n` : ""}
FILES: ${fileList}

AGENTS:
- ui-agent 🎨: HTML, CSS, layout, responsive design, visual polish
- logic-agent ⚙️: JavaScript/TypeScript, state, events, data flow  
- mobile-agent 📱: Touch, viewport, mobile-first, bottom nav
- feature-agent ✨: New features, integrations, new functionality
- debug-agent 🔍: Bug fixes, error handling, edge cases
- qa-agent ✅: Final verification — checks everything works correctly

RULES:
- For UI changes: always include mobile-agent + qa-agent
- For logic: logic-agent + qa-agent
- For new features: feature-agent + ui-agent + qa-agent
- Complex tasks: up to 4 specialist agents + qa-agent
- Each agent will use tool-calling to make actual file changes

Respond ONLY with valid JSON:
{
  "complexity": "simple|moderate|complex",
  "plan": "1-2 sentence approach",
  "agents": [
    { "id": "ui-agent", "name": "UI Agent", "icon": "🎨", "task": "very specific task description" }
  ]
}`;

    const planRaw = await callAI(planPrompt);
    const planMatch = planRaw.match(/\{[\s\S]*\}/);

    let agents: Array<{ id: string; name: string; icon: string; task: string }> = [];

    if (planMatch) {
      try {
        const plan = JSON.parse(planMatch[0]);
        agents = plan.agents ?? [];
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId: args.projectId,
          agentId: "planner",
          agentName: "Planner",
          type: "plan",
          content: `Plan: ${plan.plan ?? ""} | Agents: ${agents.map(a => a.name).join(" → ")}`,
          isStreaming: false,
        });
      } catch {
        // Fallback: single agent
        agents = [{ id: "feature-agent", name: "Feature Agent", icon: "✨", task: args.prompt }];
      }
    } else {
      agents = [{ id: "feature-agent", name: "Feature Agent", icon: "✨", task: args.prompt }];
    }

    // ── RUN AGENTS SEQUENTIALLY ───────────────────────────────────────────────
    const results: string[] = [];
    const spawnCount = { value: 0 };

    for (const agent of agents) {
      // Create task record
      await ctx.runMutation(api.agents.createTask, {
        projectId: args.projectId,
        agentId: agent.id,
        agentName: `${agent.icon} ${agent.name}`,
        agentIcon: agent.icon,
        task: agent.task,
      });

      const result = await runAgentLoop(
        ctx, args.projectId, missionId, agent.id,
        `${agent.icon} ${agent.name}`, agent.task, 0, spawnCount
      );
      results.push(`[${agent.name}] ${result}`);
    }

    const summary = results.join("\n");

    // Post result to chat if we have a session
    if (args.sessionId) {
      await ctx.runMutation(api.chat.addMessage, {
        sessionId: args.sessionId,
        projectId: args.projectId,
        role: "assistant",
        content: `✅ Mission complete!\n\n${summary}`,
      });
    }

    return summary;
  },
});
