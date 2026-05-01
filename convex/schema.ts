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
    // Multi-file context: array of { path, content } for richer AI context
    fileContexts: v.optional(v.array(v.object({
      path: v.string(),
      content: v.string(),
    }))),
    // For multi-agent mode: which agent produced this message
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
    isPublic: v.optional(v.boolean()), // public collab session links
    sessionName: v.optional(v.string()), // friendly name for the session
  })
    .index("by_code", ["inviteCode"])
    .index("by_project", ["projectId"]),

  // Smart feature suggestions
  suggestions: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    category: v.string(), // "ui", "functionality", "performance", "ux", "security"
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    status: v.union(
      v.literal("pending"),
      v.literal("implementing"),
      v.literal("done"),
      v.literal("dismissed")
    ),
    implementationPrompt: v.string(), // what to tell the AI to implement it
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
    action: v.string(), // "create_file", "edit_file", "fix_error", "add_feature"
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
    agentId: v.string(), // "ui-agent", "backend-agent", "test-agent", etc.
    agentName: v.string(),
    agentIcon: v.string(), // emoji
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
});

export default schema;
