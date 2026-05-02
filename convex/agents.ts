import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

async function callAI(prompt: string, model = "deepseek-v3.2"): Promise<string> {
  const res = await fetch(`${VIKTOR_API_URL}/api/v1/actions/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-project-name": PROJECT_NAME,
      "x-project-secret": PROJECT_SECRET,
    },
    body: JSON.stringify({
      action: "complete",
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
    }),
  });
  const data = await res.json();
  return data.result ?? data.content ?? "";
}

// Fixed agent roster — planner decides which agents to activate per task
const AGENT_TYPES = [
  {
    id: "planner-agent",
    name: "Planner",
    icon: "🗺️",
    specialty: "Decomposing tasks, assigning work to specialists, coordinating the overall approach",
  },
  {
    id: "ui-agent",
    name: "UI Agent",
    icon: "🎨",
    specialty: "HTML structure, CSS styling, layout, responsive design, and visual polish",
  },
  {
    id: "logic-agent",
    name: "Logic Agent",
    icon: "⚙️",
    specialty: "JavaScript logic, event handling, state management, and application behavior",
  },
  {
    id: "debug-agent",
    name: "Debug Agent",
    icon: "🔍",
    specialty: "Finding and fixing bugs, error handling, edge cases, and code quality",
  },
  {
    id: "feature-agent",
    name: "Feature Agent",
    icon: "✨",
    specialty: "Adding new features, integrations, and functionality enhancements",
  },
  {
    id: "test-agent",
    name: "Test Agent",
    icon: "🧪",
    specialty: "Writing tests, validating logic, checking edge cases and error paths",
  },
  {
    id: "reviewer-agent",
    name: "Reviewer",
    icon: "🔎",
    specialty: "Code review, security checks, performance analysis, and best practice enforcement",
  },
];

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export const listTasks = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("agentTasks"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      buildSessionId: v.optional(v.id("buildSessions")),
      agentId: v.string(),
      agentName: v.string(),
      agentIcon: v.string(),
      task: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("done"),
        v.literal("error")
      ),
      result: v.optional(v.string()),
      filesChanged: v.optional(v.array(v.string())),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

export const createTask = mutation({
  args: {
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    agentId: v.string(),
    agentName: v.string(),
    agentIcon: v.string(),
    task: v.string(),
  },
  returns: v.id("agentTasks"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentTasks", {
      ...args,
      status: "queued",
      startedAt: Date.now(),
    });
  },
});

export const updateTask = mutation({
  args: {
    taskId: v.id("agentTasks"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error")
    ),
    result: v.optional(v.string()),
    filesChanged: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { taskId, ...updates } = args;
    const patch: Record<string, unknown> = { ...updates };
    if (args.status === "done" || args.status === "error") {
      patch.finishedAt = Date.now();
    }
    await ctx.db.patch(taskId, patch);
  },
});

// ─── MAIN ACTION: MULTI-AGENT RUN WITH MEMORY ────────────────────────────────

export const runMultiAgent = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 0. Clear old thoughts for this project (fresh stream per task)
    await ctx.runMutation(api.agentThoughts.clearForProject, {
      projectId: args.projectId,
    });

    // Emit: planner starting
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "plan",
      content: `Received task: "${args.prompt}"`,
      isStreaming: true,
    });

    // 1. Load persistent memory for this project
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "memory",
      content: "Loading memory bank...",
      isStreaming: true,
    });
    const memoryContext = await ctx.runAction(api.memory.getMemoriesForPrompt, {
      projectId: args.projectId,
      topN: 15,
    });
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "memory",
      content: memoryContext
        ? `Loaded ${memoryContext.split("\n").length} memory entries`
        : "No prior memories — starting fresh",
    });

    // 2. Get project files
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });

    // 2b. RAG: index project and get relevant context for this task
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "search",
      content: `Indexing ${files.filter(f => !f.isDirectory).length} files for semantic search...`,
      isStreaming: true,
    });
    try {
      await ctx.runAction(api.rag.indexProject, { projectId: args.projectId });
      const ragContext = await ctx.runAction(api.rag.getContextForPrompt, {
        projectId: args.projectId,
        query: args.prompt,
      });
      if (ragContext) {
        const matchCount = (ragContext.match(/---/g) ?? []).length / 2;
        await ctx.runMutation(api.agentThoughts.emit, {
          projectId: args.projectId,
          agentId: "planner-agent",
          agentName: "Planner",
          type: "search",
          content: `Found ${matchCount} relevant files via semantic search`,
        });
      }
    } catch {
      // RAG failure is non-fatal
    }
    const fileList = files.filter((f) => !f.isDirectory).map((f) => f.path).join(", ");
    const fileContext = files
      .filter((f) => !f.isDirectory)
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    // 3. Planner decides which agents to deploy and what complexity is needed
    const planPrompt = `You are CodeForge's Planner Agent. A user wants: "${args.prompt}"

${memoryContext}

Project files: ${fileList}

Available specialist agents:
${AGENT_TYPES.filter((a) => a.id !== "planner-agent").map((a) => `- ${a.id} (${a.name}): ${a.specialty}`).join("\n")}

Analyze the complexity:
- SIMPLE (1-2 agents): small, focused change
- MODERATE (2-3 agents): multiple concerns, clear boundaries  
- COMPLEX (3-5 agents): major feature, needs testing + review

Return ONLY valid JSON (no markdown):
{
  "complexity": "simple|moderate|complex",
  "reasoning": "one sentence why",
  "agents": [
    { "agentId": "ui-agent", "task": "specific, detailed task description" }
  ]
}

Each agent task must be distinct — no two agents should touch the same files.`;

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "plan",
      content: "Analyzing task and selecting specialist agents...",
      isStreaming: true,
    });
    const planResult = await callAI(planPrompt);
    const planMatch = planResult.match(/\{[\s\S]*\}/);
    if (!planMatch) throw new Error("Planner failed to produce a valid plan");

    const plan = JSON.parse(planMatch[0]) as {
      complexity: string;
      reasoning: string;
      agents: Array<{ agentId: string; task: string }>;
    };

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "plan",
      content: `Plan: ${plan.complexity} task — deploying ${plan.agents.length} agents: ${plan.agents.map((a: {agentId: string}) => a.agentId).join(", ")}`,
    });

    // 4. Create task records in DB (so UI can show them immediately)
    const taskRecords: Array<{
      taskId: Id<"agentTasks">;
      agentId: string;
      agentName: string;
      agentIcon: string;
      task: string;
    }> = [];

    for (const planned of plan.agents) {
      const agentDef = AGENT_TYPES.find((a) => a.id === planned.agentId) ?? AGENT_TYPES[1];
      const taskId = await ctx.runMutation(api.agents.createTask, {
        projectId: args.projectId,
        agentId: agentDef.id,
        agentName: agentDef.name,
        agentIcon: agentDef.icon,
        task: planned.task,
      });
      taskRecords.push({
        taskId,
        agentId: agentDef.id,
        agentName: agentDef.name,
        agentIcon: agentDef.icon,
        task: planned.task,
      });
    }

    // 5. Run each agent sequentially with memory context + inter-agent comms
    const results: Array<{
      agentId: string;
      agentName: string;
      task: string;
      status: string;
      result?: string;
      filesChanged?: string[];
    }> = [];

    // Collect messages from previous agents to feed forward (agent-to-agent comms)
    const agentBroadcasts: string[] = [];

    for (const t of taskRecords) {
      await ctx.runMutation(api.agents.updateTask, {
        taskId: t.taskId,
        status: "running",
      });

      const agentDef = AGENT_TYPES.find((a) => a.id === t.agentId) ?? AGENT_TYPES[1];

      // Broadcast: announce this agent is starting
      await ctx.runMutation(api.memory.postAgentMessage, {
        projectId: args.projectId,
        fromAgentId: t.agentId,
        fromAgentName: t.agentName,
        fromAgentIcon: t.agentIcon,
        messageType: "context",
        content: `Starting task: ${t.task}`,
      });
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: t.agentId,
        agentName: t.agentName,
        type: "analyze",
        content: `Task: ${t.task}`,
        isStreaming: true,
      });

      const priorBroadcastContext = agentBroadcasts.length > 0
        ? `\n\nMESSAGES FROM OTHER AGENTS:\n${agentBroadcasts.join("\n")}`
        : "";

      const agentPrompt = `You are ${agentDef.name}, a specialist AI agent in CodeForge.
Specialty: ${agentDef.specialty}

${memoryContext}

USER'S ORIGINAL REQUEST: "${args.prompt}"
YOUR SPECIFIC TASK: ${t.task}
PLAN COMPLEXITY: ${plan.complexity} — ${plan.reasoning}

PROJECT FILES:
${fileContext}
${priorBroadcastContext}

Instructions:
1. Focus ONLY on your specific task. Don't duplicate work another agent is doing.
2. Return a JSON object with your changes and a broadcast message for other agents.
3. Be precise — write complete file contents, not diffs.

Return ONLY valid JSON (no markdown):
{
  "changes": [
    { "path": "relative/path/file.ext", "action": "create|edit", "content": "complete file content here" }
  ],
  "summary": "What you accomplished",
  "broadcast": {
    "messageType": "finding|warning|context|resolved",
    "content": "message to other agents about what you found or did (be specific about files/patterns)"
  },
  "filesChanged": ["list", "of", "paths"]
}`;

      try {
        const agentResult = await callAI(agentPrompt);
        const jsonMatch = agentResult.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          await ctx.runMutation(api.agentThoughts.emit, {
            projectId: args.projectId,
            agentId: t.agentId,
            agentName: t.agentName,
            type: "code",
            content: "Applying file changes...",
            isStreaming: true,
          });
          const parsed = JSON.parse(jsonMatch[0]) as {
            changes?: Array<{ path: string; action: string; content: string }>;
            summary?: string;
            broadcast?: { messageType: string; content: string };
            filesChanged?: string[];
          };

          // Apply file changes
          const changedPaths: string[] = [];
          for (const change of (parsed.changes ?? [])) {
            const existing = await ctx.runQuery(api.files.getByPath, {
              projectId: args.projectId,
              path: change.path,
            });

            if (existing) {
              await ctx.runMutation(api.files.update, {
                fileId: existing._id,
                content: change.content,
              });
            } else if (change.action === "create") {
              const parts = change.path.split("/");
              await ctx.runMutation(api.files.create, {
                projectId: args.projectId,
                path: change.path,
                name: parts[parts.length - 1],
                content: change.content,
                isDirectory: false,
                parentPath: parts.slice(0, -1).join("/") || undefined,
              });
            }
            changedPaths.push(change.path);
          }

          // Post broadcast message to the agent message bus
          if (parsed.broadcast) {
            const validTypes = ["warning", "context", "request", "finding", "blocker", "resolved"];
            const msgType = validTypes.includes(parsed.broadcast.messageType)
              ? parsed.broadcast.messageType
              : "finding";

            await ctx.runMutation(api.memory.postAgentMessage, {
              projectId: args.projectId,
              fromAgentId: t.agentId,
              fromAgentName: t.agentName,
              fromAgentIcon: t.agentIcon,
              messageType: msgType as "warning" | "context" | "request" | "finding" | "blocker" | "resolved",
              content: parsed.broadcast.content,
              relatedFiles: changedPaths,
            });

            // Add to the rolling broadcast context for subsequent agents
            agentBroadcasts.push(`[${t.agentName}] ${parsed.broadcast.content}`);
          }

          await ctx.runMutation(api.agentThoughts.emit, {
            projectId: args.projectId,
            agentId: t.agentId,
            agentName: t.agentName,
            type: "done",
            content: `${parsed.summary ?? "Completed"} — changed: ${changedPaths.join(", ") || "no files"}`,
          });
          await ctx.runMutation(api.agents.updateTask, {
            taskId: t.taskId,
            status: "done",
            result: parsed.summary ?? "Completed",
            filesChanged: changedPaths,
          });

          results.push({
            agentId: t.agentId,
            agentName: t.agentName,
            task: t.task,
            status: "done",
            result: parsed.summary,
            filesChanged: changedPaths,
          });
        } else {
          throw new Error("Agent returned non-JSON output");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await ctx.runMutation(api.memory.postAgentMessage, {
          projectId: args.projectId,
          fromAgentId: t.agentId,
          fromAgentName: t.agentName,
          fromAgentIcon: t.agentIcon,
          messageType: "blocker",
          content: `Failed: ${errorMsg}`,
        });

        await ctx.runMutation(api.agents.updateTask, {
          taskId: t.taskId,
          status: "error",
          result: errorMsg,
        });

        results.push({
          agentId: t.agentId,
          agentName: t.agentName,
          task: t.task,
          status: "error",
          result: errorMsg,
        });
      }
    }

    // 6. Run retrospective automatically after all agents complete
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "retrospective-agent",
      agentName: "Retrospective",
      type: "review",
      content: "Analyzing completed run — extracting learnings for memory...",
      isStreaming: true,
    });
    try {
      await ctx.runAction(api.memory.runRetrospective, {
        projectId: args.projectId,
        triggerTaskId: taskRecords[0]?.taskId,
        agentResults: results,
        originalPrompt: args.prompt,
      });
    } catch (e) {
      // Retrospective failure should never crash the main task
      console.error("Retrospective failed:", e);
    }

    const successCount = results.filter((r) => r.status === "done").length;
    const totalCount = results.length;

    // 7. Auto-push to GitHub if project has a configured repo
    if (successCount > 0) {
      try {
        const project = await ctx.runQuery(api.projects.get, { projectId: args.projectId });
        if (project?.githubRepo) {
          await ctx.runMutation(api.agentThoughts.emit, {
            projectId: args.projectId,
            agentId: "planner-agent",
            agentName: "Planner",
            type: "commit",
            content: `Auto-pushing ${results.flatMap(r => r.filesChanged ?? []).length} changed files to ${project.githubRepo}...`,
            isStreaming: true,
          });

          const changedFiles = [...new Set(results.flatMap((r) => r.filesChanged ?? []))];
          const branchName = `agent/${args.prompt.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
          const commitMsg = `feat(agent): ${args.prompt.slice(0, 72)}`;

          const pushResult = await ctx.runAction(api.git.pushToGitHub, {
            projectId: args.projectId,
            repoFullName: project.githubRepo,
            branchName,
            commitMessage: commitMsg,
            createPR: true,
            prTitle: args.prompt.slice(0, 100),
            prBody: [
              "## CodeForge Agent Run",
              "",
              `**Task:** ${args.prompt}`,
              `**Complexity:** ${plan.complexity}`,
              `**Agents:** ${plan.agents.length} (${plan.agents.map((a: {agentId: string}) => a.agentId).join(", ")})`,
              `**Result:** ${successCount}/${totalCount} agents succeeded`,
              "",
              "### Files Changed",
              changedFiles.map((f) => `- \`${f}\``).join("\n"),
            ].join("\n"),
          });

          await ctx.runMutation(api.agentThoughts.emit, {
            projectId: args.projectId,
            agentId: "planner-agent",
            agentName: "Planner",
            type: "commit",
            content: pushResult.success
              ? `✓ Pushed to ${branchName}${pushResult.prUrl ? " · PR opened" : ""}`
              : `⚠ Git push skipped: ${pushResult.error}`,
          });
        }
      } catch {
        // Auto-push failure is non-fatal
      }
    }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner-agent",
      agentName: "Planner",
      type: "done",
      content: `All done — ${successCount}/${totalCount} agents completed`,
    });

    const summary = results
      .map((r) => `${r.agentName}: ${r.result ?? r.status}`)
      .join("\n");

    return `${successCount}/${totalCount} agents completed (${plan.complexity} task)\n\n${summary}`;
  },
});
