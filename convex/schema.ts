import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // Projects (imported repos or new projects)
  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    githubRepo: v.optional(v.string()),
    language: v.optional(v.string()),
    lastOpenedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_name", ["ownerId", "name"]),

  // Files within a project
  files: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    name: v.string(),
    content: v.string(),
    language: v.optional(v.string()),
    isDirectory: v.boolean(),
    parentPath: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "path"]),

  // Chat sessions per project
  chatSessions: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.optional(v.string()),
    model: v.string(),
    totalTokensUsed: v.number(),
    totalCost: v.number(),
    createdAt: v.optional(v.number()),
    isArchived: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // Chat messages
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    model: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    cost: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    fileContexts: v.optional(v.array(v.object({
      path: v.string(),
      content: v.string(),
    }))),
    agentId: v.optional(v.string()),
    agentRole: v.optional(v.string()),
  }).index("by_session", ["sessionId"]),

  // Collaboration: active presence in a project
  collaborators: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    userName: v.string(),
    activeFile: v.optional(v.string()),
    cursorLine: v.optional(v.number()),
    cursorColumn: v.optional(v.number()),
    lastSeenAt: v.number(),
    color: v.string(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_user", ["projectId", "userId"]),

  // Collaboration invites (shareable links)
  projectInvites: defineTable({
    projectId: v.id("projects"),
    invitedBy: v.id("users"),
    inviteCode: v.string(),
    expiresAt: v.number(),
    isPublic: v.optional(v.boolean()),
    sessionName: v.optional(v.string()),
  })
    .index("by_code", ["inviteCode"])
    .index("by_project", ["projectId"]),

  // Smart feature suggestions
  suggestions: defineTable({
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
    .index("by_project", ["projectId"])
    .index("by_project_and_status", ["projectId", "status"]),

  // Change history: tracks file changes for undo/rollback
  changeHistory: defineTable({
    projectId: v.id("projects"),
    suggestionId: v.optional(v.id("suggestions")),
    buildStepId: v.optional(v.id("buildSteps")),
    filePath: v.string(),
    previousContent: v.string(),
    newContent: v.string(),
    action: v.union(v.literal("create"), v.literal("edit"), v.literal("delete")),
    timestamp: v.number(),
    undone: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_suggestion", ["suggestionId"]),

  // Build loop: tracks autonomous build steps
  buildSessions: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    status: v.union(
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("error")
    ),
    currentStep: v.optional(v.string()),
    totalSteps: v.optional(v.number()),
    completedSteps: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),

  // Build steps (log of what the AI did in a build session)
  buildSteps: defineTable({
    buildSessionId: v.id("buildSessions"),
    projectId: v.id("projects"),
    stepNumber: v.number(),
    action: v.string(),
    description: v.string(),
    filesChanged: v.array(v.string()),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_build_session", ["buildSessionId"])
    .index("by_project", ["projectId"]),

  // Multi-agent tasks
  agentTasks: defineTable({
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
    .index("by_project", ["projectId"])
    .index("by_build_session", ["buildSessionId"]),

  // ─── AGENT MEMORY SYSTEM ────────────────────────────────────────────────────

  // Persistent memories that accumulate across every agent task
  agentMemories: defineTable({
    projectId: v.id("projects"),
    category: v.union(
      v.literal("pattern"),       // recurring code patterns that work well
      v.literal("anti_pattern"),  // things that consistently break
      v.literal("preference"),    // user style/architecture preferences
      v.literal("architecture"),  // high-level structural decisions
      v.literal("dependency"),    // library/tool choices and gotchas
      v.literal("bugfix"),        // specific bugs and their fixes
      v.literal("convention"),    // naming, formatting, file structure
      v.literal("tool"),          // effective tool/API usage patterns
      v.literal("insight")        // general observations about the codebase
    ),
    content: v.string(),          // the actual memory text injected into prompts
    importance: v.number(),       // 0.0–1.0, used to rank which memories to inject
    usageCount: v.number(),       // how many times this memory has been used
    lastUsedAt: v.number(),       // for decay calculation
    sourceTaskId: v.optional(v.id("agentTasks")),       // which task created this
    sourceRetroId: v.optional(v.id("taskRetrospectives")), // which retro created this
    decayFactor: v.number(),      // 0.0–1.0, multiplied into importance over time
    embedding: v.optional(v.string()), // future: vector embedding for semantic search
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_category", ["projectId", "category"])
    .index("by_project_and_importance", ["projectId", "importance"]),

  // ─── SELF-IMPROVEMENT: RETROSPECTIVES ───────────────────────────────────────

  // After every completed agent run, a Retrospective agent analyzes what happened
  taskRetrospectives: defineTable({
    projectId: v.id("projects"),
    triggerTaskId: v.optional(v.id("agentTasks")),   // which task triggered this retro
    buildSessionId: v.optional(v.id("buildSessions")),
    qualityScore: v.number(),     // 1–10, how well did the agents perform?
    whatWorked: v.array(v.string()),
    whatFailed: v.array(v.string()),
    improvements: v.array(v.string()),  // concrete changes for future prompts
    memoriesCreated: v.array(v.id("agentMemories")), // memories extracted from this retro
    rawAnalysis: v.string(),      // full retrospective text from the AI
    agentsInvolved: v.array(v.string()),  // which agent IDs were analyzed
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── AGENT-TO-AGENT COMMUNICATION ───────────────────────────────────────────

  // Real-time message bus between agents during a task
  agentMessages: defineTable({
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    fromAgentId: v.string(),      // "ui-agent", "planner", "retrospective-agent", etc.
    fromAgentName: v.string(),
    fromAgentIcon: v.string(),
    toAgentId: v.optional(v.string()),  // null = broadcast to all agents
    toAgentName: v.optional(v.string()),
    messageType: v.union(
      v.literal("warning"),    // "watch out for X"
      v.literal("context"),    // "here's info you'll need"
      v.literal("request"),    // "can you handle X?"
      v.literal("finding"),    // "I discovered Y"
      v.literal("blocker"),    // "I'm stuck on Z"
      v.literal("resolved")    // "blocker Z is now fixed"
    ),
    content: v.string(),
    relatedFiles: v.optional(v.array(v.string())),
    timestamp: v.number(),
    acknowledged: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_build_session", ["buildSessionId"])
    .index("by_project_and_time", ["projectId", "timestamp"]),
});

export default schema;
