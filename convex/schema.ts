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
    githubRepo: v.optional(v.string()), // e.g. "owner/repo"
    githubToken: v.optional(v.string()), // encrypted token
    language: v.optional(v.string()),
    lastOpenedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_name", ["ownerId", "name"]),

  // Files within a project
  files: defineTable({
    projectId: v.id("projects"),
    path: v.string(), // e.g. "src/index.html"
    name: v.string(), // e.g. "index.html"
    content: v.string(),
    language: v.optional(v.string()), // detected language
    isDirectory: v.boolean(),
    parentPath: v.optional(v.string()), // parent directory path
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "path"]),

  // Chat sessions per project
  chatSessions: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.optional(v.string()),
    model: v.string(), // current model for session
    totalTokensUsed: v.number(),
    totalCost: v.number(), // in dollars
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // Chat messages
  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")), // null for AI messages
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    model: v.optional(v.string()), // which model generated this
    tokensUsed: v.optional(v.number()),
    cost: v.optional(v.number()),
    isError: v.optional(v.boolean()),
  }).index("by_session", ["sessionId"]),

  // Collaboration: active presence in a project
  collaborators: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    userName: v.string(),
    activeFile: v.optional(v.string()), // which file they're viewing
    cursorLine: v.optional(v.number()),
    cursorColumn: v.optional(v.number()),
    lastSeenAt: v.number(),
    color: v.string(), // assigned color for presence indicator
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_user", ["projectId", "userId"]),

  // Collaboration invites
  projectInvites: defineTable({
    projectId: v.id("projects"),
    invitedBy: v.id("users"),
    inviteCode: v.string(),
    expiresAt: v.number(),
  })
    .index("by_code", ["inviteCode"])
    .index("by_project", ["projectId"]),
});

export default schema;
