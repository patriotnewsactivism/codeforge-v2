import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

// Agent definitions
const AGENT_TYPES = [
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
];

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
      .collect();
  },
});

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
  returns: v.null(),
  handler: async (ctx, args) => {
    const update: Record<string, unknown> = { status: args.status };
    if (args.result !== undefined) update.result = args.result;
    if (args.filesChanged !== undefined) update.filesChanged = args.filesChanged;
    if (args.status === "done" || args.status === "error") {
      update.finishedAt = Date.now();
    }
    await ctx.db.patch(args.taskId, update);
    return null;
  },
});

// Spawn multiple agents to work on a task in parallel
export const runMultiAgent = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Get project files
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });
    const fileContext = files
      .filter((f) => !f.isDirectory)
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    // Ask planner AI to decide which agents to deploy
    const planPrompt = `You are CodeForge AI orchestrator. A user wants: "${args.prompt}"

Their project has these files:
${files.filter((f) => !f.isDirectory).map((f) => f.path).join(", ")}

Available agents:
${AGENT_TYPES.map((a) => `- ${a.id} (${a.name}): ${a.specialty}`).join("\n")}

Decide which agents should work on this task and what each should do.
Return ONLY a JSON array (no markdown):
[
  { "agentId": "ui-agent", "task": "specific task for this agent" },
  { "agentId": "logic-agent", "task": "specific task for this agent" }
]

Use 2-4 agents. Each agent should work on different files to avoid conflicts.`;

    const planResult = await callAI(planPrompt);
    const planMatch = planResult.match(/\[[\s\S]*\]/);
    if (!planMatch) throw new Error("Failed to plan agent tasks");

    const agentPlan = JSON.parse(planMatch[0]) as Array<{
      agentId: string;
      task: string;
    }>;

    // Create task records
    const taskIds: Array<{ taskId: Id<"agentTasks">; agentId: string; task: string }> = [];
    for (const plan of agentPlan) {
      const agentDef = AGENT_TYPES.find((a) => a.id === plan.agentId) ?? AGENT_TYPES[0];
      const taskId = await ctx.runMutation(api.agents.createTask, {
        projectId: args.projectId,
        agentId: agentDef.id,
        agentName: agentDef.name,
        agentIcon: agentDef.icon,
        task: plan.task,
      });
      taskIds.push({ taskId, agentId: agentDef.id, task: plan.task });
    }

    // Run agents sequentially (Convex actions can't do true parallel within one action,
    // but we mark them as running in the DB so the UI shows them working)
    const results: string[] = [];
    for (const t of taskIds) {
      const agentDef = AGENT_TYPES.find((a) => a.id === t.agentId) ?? AGENT_TYPES[0];
      await ctx.runMutation(api.agents.updateTask, {
        taskId: t.taskId,
        status: "running",
      });

      try {
        const agentPrompt = `You are ${agentDef.name}, an AI agent specializing in ${agentDef.specialty}.

Project files:
${fileContext}

Your task: ${t.task}

If you need to modify files, return a JSON object:
{
  "changes": [
    { "path": "filename.ext", "action": "create" | "edit", "content": "full file content" }
  ],
  "summary": "What you did"
}

If no file changes needed, return: { "changes": [], "summary": "explanation" }
Return ONLY JSON, no markdown.`;

        const result = await callAI(agentPrompt);
        const jsonMatch = result.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            changes: Array<{ path: string; action: string; content: string }>;
            summary: string;
          };

          const changedFiles: string[] = [];
          for (const change of parsed.changes) {
            const existingFile = files.find((f) => f.path === change.path);
            const cleanContent = change.content
              .replace(/^```[\w]*\n?/, "")
              .replace(/\n?```$/, "")
              .trim();

            if (existingFile && change.action === "edit") {
              await ctx.runMutation(api.files.updateContent, {
                fileId: existingFile._id,
                content: cleanContent,
              });
            } else if (change.action === "create") {
              const name = change.path.split("/").pop() ?? change.path;
              await ctx.runMutation(api.files.create, {
                projectId: args.projectId,
                path: change.path,
                name,
                isDirectory: false,
              });
              const updatedFiles = await ctx.runQuery(api.files.listByProject, {
                projectId: args.projectId,
              });
              const newFile = updatedFiles.find((f) => f.path === change.path);
              if (newFile) {
                await ctx.runMutation(api.files.updateContent, {
                  fileId: newFile._id,
                  content: cleanContent,
                });
              }
            }
            changedFiles.push(change.path);
          }

          await ctx.runMutation(api.agents.updateTask, {
            taskId: t.taskId,
            status: "done",
            result: parsed.summary,
            filesChanged: changedFiles,
          });
          results.push(`${agentDef.icon} ${agentDef.name}: ${parsed.summary}`);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await ctx.runMutation(api.agents.updateTask, {
          taskId: t.taskId,
          status: "error",
          result: errMsg,
        });
        results.push(`${agentDef.icon} ${agentDef.name}: Error - ${errMsg}`);
      }
    }

    return results.join("\n");
  },
});

async function callAI(prompt: string): Promise<string> {
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

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const json = await response.json();
  if (!json.success) throw new Error(json.error ?? "AI call failed");
  return json.result.search_response;
}
