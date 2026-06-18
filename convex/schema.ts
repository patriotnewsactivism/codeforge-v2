import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    githubToken: v.optional(v.string()),
    onboarded: v.optional(v.boolean()),
    plan: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
  }).index("by_email", ["email"]),

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
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    model: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    cost: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    fileContexts: v.optional(
      v.array(
        v.object({
          path: v.string(),
          content: v.string(),
        }),
      ),
    ),
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
      v.literal("dismissed"),
    ),
    implementationPrompt: v.string(),
    generatedAt: v.number(),
    impactScore: v.optional(v.number()),
    autoApproved: v.optional(v.boolean()),
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
    action: v.union(
      v.literal("create"),
      v.literal("edit"),
      v.literal("delete"),
    ),
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
      v.literal("error"),
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
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
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
      v.literal("error"),
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
      v.literal("pattern"), // recurring code patterns that work well
      v.literal("anti_pattern"), // things that consistently break
      v.literal("preference"), // user style/architecture preferences
      v.literal("architecture"), // high-level structural decisions
      v.literal("dependency"), // library/tool choices and gotchas
      v.literal("bugfix"), // specific bugs and their fixes
      v.literal("convention"), // naming, formatting, file structure
      v.literal("tool"), // effective tool/API usage patterns
      v.literal("insight"), // general observations about the codebase
      v.literal("skill"), // new skill that the agent learned
    ),
    content: v.string(), // the actual memory text injected into prompts
    importance: v.number(), // 0.0–1.0, used to rank which memories to inject
    usageCount: v.number(), // how many times this memory has been used
    lastUsedAt: v.number(), // for decay calculation
    sourceTaskId: v.optional(v.id("agentTasks")), // which task created this
    sourceRetroId: v.optional(v.id("taskRetrospectives")), // which retro created this
    decayFactor: v.number(), // 0.0–1.0, multiplied into importance over time
    embedding: v.optional(v.string()), // future: vector embedding for semantic search
    isApproved: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_category", ["projectId", "category"])
    .index("by_project_and_importance", ["projectId", "importance"]),

  // ─── SELF-IMPROVEMENT: RETROSPECTIVES ───────────────────────────────────────

  // After every completed agent run, a Retrospective agent analyzes what happened
  taskRetrospectives: defineTable({
    projectId: v.id("projects"),
    triggerTaskId: v.optional(v.id("agentTasks")), // which task triggered this retro
    buildSessionId: v.optional(v.id("buildSessions")),
    qualityScore: v.number(), // 1–10, how well did the agents perform?
    whatWorked: v.array(v.string()),
    whatFailed: v.array(v.string()),
    improvements: v.array(v.string()), // concrete changes for future prompts
    memoriesCreated: v.array(v.id("agentMemories")), // memories extracted from this retro
    rawAnalysis: v.string(), // full retrospective text from the AI
    agentsInvolved: v.array(v.string()), // which agent IDs were analyzed
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── AGENT-TO-AGENT COMMUNICATION ───────────────────────────────────────────

  // Real-time message bus between agents during a task
  agentMessages: defineTable({
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    fromAgentId: v.string(), // "ui-agent", "planner", "retrospective-agent", etc.
    fromAgentName: v.string(),
    fromAgentIcon: v.string(),
    toAgentId: v.optional(v.string()), // null = broadcast to all agents
    toAgentName: v.optional(v.string()),
    messageType: v.union(
      v.literal("warning"), // "watch out for X"
      v.literal("context"), // "here's info you'll need"
      v.literal("request"), // "can you handle X?"
      v.literal("finding"), // "I discovered Y"
      v.literal("blocker"), // "I'm stuck on Z"
      v.literal("resolved"), // "blocker Z is now fixed"
    ),
    content: v.string(),
    relatedFiles: v.optional(v.array(v.string())),
    timestamp: v.number(),
    acknowledged: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_build_session", ["buildSessionId"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── GIT INTEGRATION ────────────────────────────────────────────────────────

  // Commits made by agents (or manual pushes) to GitHub
  gitCommits: defineTable({
    projectId: v.id("projects"),
    sha: v.string(),
    message: v.string(),
    branch: v.string(),
    filesChanged: v.array(v.string()),
    agentId: v.optional(v.string()),
    buildSessionId: v.optional(v.id("buildSessions")),
    timestamp: v.number(),
    pushedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_branch", ["projectId", "branch"]),

  // Git branches tracked per project
  gitBranches: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    isActive: v.boolean(),
    headSha: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    status: v.union(
      v.literal("open"),
      v.literal("merged"),
      v.literal("closed"),
      v.literal("local"),
    ),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_name", ["projectId", "name"]),

  // ─── CODEBASE RAG INDEX ──────────────────────────────────────────────────────

  // TF-IDF index of every file — enables semantic search across the codebase
  codebaseIndex: defineTable({
    projectId: v.id("projects"),
    fileId: v.id("files"),
    path: v.string(),
    language: v.string(),
    termFrequency: v.string(), // JSON-serialized Record<string, number>
    tags: v.array(v.string()), // function names, imports, class names
    tokenCount: v.number(),
    indexedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "path"]),

  // ─── STREAMING THOUGHT PROCESS ──────────────────────────────────────────────

  // Real-time stream of agent thinking — emitted token by token,
  // subscribed live in the frontend via Convex's real-time queries
  agentThoughts: defineTable({
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    agentId: v.string(),
    agentName: v.string(),
    type: v.union(
      v.literal("plan"),
      v.literal("analyze"),
      v.literal("code"),
      v.literal("debug"),
      v.literal("review"),
      v.literal("memory"),
      v.literal("search"),
      v.literal("commit"),
      v.literal("broadcast"),
      v.literal("done"),
      v.literal("action"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("warning"),
      v.literal("thinking"),
      v.literal("finding"),
    ),
    content: v.string(),
    isStreaming: v.optional(v.boolean()),
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_build_session", ["buildSessionId"]),

  // Per-project settings: autonomous mode, soul/identity, auto-build config
  projectSettings: defineTable({
    projectId: v.id("projects"),
    autonomousMode: v.boolean(),
    autonomousLevel: v.optional(v.string()), // "manual" | "suggest" | "apply" | "autonomous" | "autopilot"
    autoIntervalMinutes: v.number(),
    lastAutoRunAt: v.optional(v.number()),
    projectSoul: v.optional(v.string()), // core identity — agents never violate this
  }).index("by_project", ["projectId"]),

  // ─── V2 ENGINE: TOOL CALL STREAM ────────────────────────────────────────────
  // Live stream of every tool call made by agents — subscribed in real-time by frontend
  toolCalls: defineTable({
    projectId: v.id("projects"),
    missionId: v.string(), // groups all calls from one runMission invocation
    agentId: v.string(),
    agentName: v.string(),
    tool: v.string(), // tool name: create_file, edit_file, etc.
    args: v.string(), // JSON-serialized args
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    timestamp: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_mission", ["missionId"]),

  // ─── STRIPE SUBSCRIPTIONS ────────────────────────────────────────────────────
  subscriptions: defineTable({
    userId: v.id("users"),
    planKey: v.string(), // "free" | "weekly" | "monthly" | "lifetime"
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()), // Unix ms
    status: v.string(), // "active" | "past_due" | "cancelled"
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // ─── BYOK: PER-USER API KEYS ─────────────────────────────────────────────────
  userApiKeys: defineTable({
    userId: v.id("users"),
    provider: v.union(
      v.literal("openai"),
      v.literal("deepseek"),
      v.literal("xai"),
      v.literal("moonshot"),
    ),
    encryptedKey: v.string(),
    maskedKey: v.string(),
    isValid: v.optional(v.boolean()),
    validatedAt: v.optional(v.number()),
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_provider", ["userId", "provider"]),

  // ─── USAGE TRACKING ──────────────────────────────────────────────────────────

  // Per-user daily usage counters — reset each day
  userUsage: defineTable({
    userId: v.string(),
    date: v.string(), // "YYYY-MM-DD"
    aiRequests: v.number(), // chat messages sent to AI
    missions: v.number(), // agent missions started
    agentsSpawned: v.number(), // total agent spawns across all missions
    computeCostUsd: v.number(), // running $ cost this period
    periodStart: v.number(), // epoch ms of period start (daily reset)
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user", ["userId"]),

  // Per-user monthly spend accumulator (for hard cost cap)
  userSpend: defineTable({
    userId: v.string(),
    periodKey: v.string(), // "YYYY-MM" for monthly, "YYYY-WNN" for weekly
    totalCostUsd: v.number(),
    capUsd: v.number(), // hard cap for this period
    cappedAt: v.optional(v.number()), // epoch ms when cap was hit
    plan: v.string(),
  }).index("by_user_period", ["userId", "periodKey"]),

  // ─── Sessions (chat session lifecycle) ──────────────────────────
  sessions: defineTable({
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    name: v.string(),
    model: v.string(),
    totalInputTokens: v.optional(v.number()),
    totalOutputTokens: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    isActive: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_user_active", ["userId", "isActive"])
    .index("by_project", ["projectId"]),

  // ─── GitHub Settings (migrated from v1) ─────────────────────────
  githubSettings: defineTable({
    userId: v.id("users"),
    token: v.string(),
    username: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // ─── Cost Entries — Per-call cost log ────────────────────────────
  costEntries: defineTable({
    userId: v.id("users"),
    buildSessionId: v.optional(v.id("buildSessions")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.number(),
    operation: v.string(),
  }).index("by_user", ["userId"]),

  // ─── Shareable Project Previews ──────────────────────────────────
  projectShares: defineTable({
    projectId: v.id("projects"),
    token: v.string(),
    expiry: v.string(),
    expiresAt: v.optional(v.number()),
    hasPassword: v.boolean(),
    passwordHash: v.optional(v.string()),
    isActive: v.boolean(),
    viewCount: v.number(),
    lastViewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_token", ["token"]),

  // ─── RAG CHUNKS — Code search index ─────────────────────────────────────────
  ragChunks: defineTable({
    projectId: v.id("projects"),
    filePath: v.string(),
    chunkType: v.string(), // "block", "function", "class"
    name: v.optional(v.string()), // function/class name if applicable
    content: v.string(),
    startLine: v.number(),
    endLine: v.number(),
    embedding: v.optional(v.string()), // JSON-serialized TF-IDF vector
    language: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_file", ["projectId", "filePath"]),

  // ─── DEBATE ENGINE ────────────────────────────────────────────────────────────
  // Every architectural/destructive decision runs through Proponent→Opponent→Moderator
  debates: defineTable({
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    proposal: v.string(),
    proponentArgument: v.string(),
    opponentArgument: v.string(),
    moderatorReasoning: v.string(),
    verdict: v.union(
      v.literal("PROCEED"),
      v.literal("REFINE"),
      v.literal("ESCALATE"),
    ),
    refinements: v.optional(v.array(v.string())),
    escalationReason: v.optional(v.string()),
    confidence: v.number(), // 0–100
    durationMs: v.number(),
    timestamp: v.number(),
    humanApproved: v.boolean(), // true after human approves an ESCALATE verdict
    approvedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_verdict", ["projectId", "verdict"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── GITOPS BRIDGE ────────────────────────────────────────────────────────────
  deployments: defineTable({
    projectId: v.id("projects"),
    branchName: v.string(),
    prNumber: v.optional(v.number()),
    prUrl: v.optional(v.string()),
    commitSha: v.string(),
    commitMessage: v.string(),
    repoFullName: v.string(),
    triggeredByAgentId: v.string(),
    buildSessionId: v.optional(v.id("buildSessions")),
    deploymentCertificate: v.optional(v.string()),
    status: v.union(
      v.literal("pending_ci"),
      v.literal("ci_running"),
      v.literal("ci_failed"),
      v.literal("awaiting_human"),
      v.literal("deploying"),
      v.literal("canary"),
      v.literal("deployed"),
      v.literal("rolled_back"),
    ),
    ciSummary: v.optional(v.string()),
    humanApproved: v.boolean(),
    approvedBy: v.optional(v.string()),
    canaryPercent: v.number(),
    createdAt: v.number(),
    deployedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_status", ["projectId", "status"]),

  // ─── SENTRY AGENT ─────────────────────────────────────────────────────────────
  sentryViolations: defineTable({
    projectId: v.id("projects"),
    agentId: v.string(),
    agentRole: v.string(),
    tool: v.string(),
    args: v.string(),
    violationType: v.union(
      v.literal("unauthorized_tool"),
      v.literal("spawn_depth_exceeded"),
      v.literal("unauthorized_spawn"),
      v.literal("rate_limit_exceeded"),
      v.literal("dangerous_pattern"),
      v.literal("debate_required"),
    ),
    details: v.string(),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    blocked: v.boolean(),
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_severity", ["projectId", "severity"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── LEARNING LOOP: FORENSIC ──────────────────────────────────────────────────
  forensicReports: defineTable({
    projectId: v.id("projects"),
    missionId: v.optional(v.id("buildSessions")),
    buildSessionId: v.optional(v.id("buildSessions")),
    failureClass: v.string(),
    rootCause: v.string(),
    evidenceQuotes: v.array(v.string()),
    proposedMutation: v.string(),
    mutationTarget: v.union(
      v.literal("prompt"),
      v.literal("tool_policy"),
      v.literal("retry_strategy"),
      v.literal("model_assignment"),
      v.literal("none"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    confidence: v.number(),
    timestamp: v.number(),
    mutationApplied: v.boolean(),
    appliedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_severity", ["projectId", "severity"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── LEARNING LOOP: MUTATION ENGINE ───────────────────────────────────────────
  mutationLog: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("forensicReports"),
    proposedMutation: v.string(),
    mutationTarget: v.union(
      v.literal("prompt"),
      v.literal("tool_policy"),
      v.literal("retry_strategy"),
      v.literal("model_assignment"),
      v.literal("none"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    autoApply: v.boolean(),
    status: v.union(
      v.literal("pending_review"),
      v.literal("pending_apply"),
      v.literal("applied"),
      v.literal("rejected"),
      v.literal("rolled_back"),
    ),
    appliedPatch: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    version: v.number(),
    rollbackAvailable: v.boolean(),
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_status", ["projectId", "status"]),

  // ─── LEARNING LOOP: REFLECTION AGENT ──────────────────────────────────────────
  reflectionSessions: defineTable({
    projectId: v.id("projects"),
    mutationsReviewed: v.number(),
    mutationsApproved: v.number(),
    mutationsRejected: v.number(),
    retrospectivesRead: v.number(),
    forensicReportsRead: v.number(),
    lessonsLearned: v.array(v.string()),
    overallHealthScore: v.number(),
    summary: v.string(),
    nextActions: v.array(v.string()),
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_time", ["projectId", "timestamp"]),

  // ─── CINEMA: MISSION REPLAY ────────────────────────────────────────────────────
  cinemaFrames: defineTable({
    projectId: v.id("projects"),
    missionId: v.id("buildSessions"),
    buildSessionId: v.optional(v.id("buildSessions")),
    frameType: v.union(
      v.literal("spawn"),
      v.literal("tool_call"),
      v.literal("tool_result"),
      v.literal("thought"),
      v.literal("debate"),
      v.literal("sentry"),
      v.literal("message"),
      v.literal("memory_read"),
      v.literal("memory_write"),
      v.literal("complete"),
      v.literal("error"),
    ),
    agentId: v.string(),
    agentName: v.string(),
    agentRole: v.optional(v.string()),
    parentAgentId: v.optional(v.string()),
    spawnDepth: v.optional(v.number()),
    payload: v.string(),
    durationMs: v.optional(v.number()),
    success: v.optional(v.boolean()),
    ts: v.number(),
  })
    .index("by_mission", ["missionId"])
    .index("by_project", ["projectId"])
    .index("by_mission_ts", ["missionId", "ts"]),

  // ─── CROSS-PROJECT INTELLIGENCE ────────────────────────────────────────────────
  globalInsights: defineTable({
    userId: v.id("users"),
    pattern: v.string(),
    detail: v.string(),
    insightType: v.union(
      v.literal("anti_pattern"),
      v.literal("best_practice"),
      v.literal("architecture"),
      v.literal("gotcha"),
      v.literal("performance"),
      v.literal("security"),
    ),
    exampleCode: v.optional(v.string()),
    occurrenceCount: v.number(),
    projectIds: v.array(v.string()),
    confidence: v.number(),
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "insightType"]),

  // ─── BENCHMARKS ────────────────────────────────────────────────────────────────
  benchmarkRuns: defineTable({
    projectId: v.id("projects"),
    taskDescription: v.string(),
    agentRole: v.string(),
    modelA: v.string(),
    modelB: v.string(),
    outputA: v.string(),
    outputB: v.string(),
    scoreA: v.number(),
    scoreB: v.number(),
    winner: v.union(v.literal("A"), v.literal("B"), v.literal("tie")),
    judgeReasoning: v.string(),
    latencyAMs: v.number(),
    latencyBMs: v.number(),
    tokensA: v.optional(v.number()),
    tokensB: v.optional(v.number()),
    dimensions: v.object({
      correctness: v.object({ a: v.number(), b: v.number() }),
      codeQuality: v.object({ a: v.number(), b: v.number() }),
      conciseness: v.object({ a: v.number(), b: v.number() }),
      followsInstructions: v.object({ a: v.number(), b: v.number() }),
    }),
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_role", ["projectId", "agentRole"]),

  // ─── ERROR INGESTION ───────────────────────────────────────────────────────────
  errorIncidents: defineTable({
    projectId: v.id("projects"),
    source: v.union(
      v.literal("sentry"),
      v.literal("datadog"),
      v.literal("bugsnag"),
      v.literal("cloudwatch"),
      v.literal("webhook"),
      v.literal("manual"),
    ),
    errorType: v.string(),
    errorMessage: v.string(),
    stackTrace: v.optional(v.string()),
    affectedFile: v.optional(v.string()),
    affectedFunction: v.optional(v.string()),
    environment: v.optional(v.string()),
    occurrenceCount: v.number(),
    rawPayload: v.optional(v.string()),
    fingerprint: v.string(),
    status: v.union(
      v.literal("new"),
      v.literal("analyzing"),
      v.literal("fixing"),
      v.literal("pr_opened"),
      v.literal("resolved"),
      v.literal("wont_fix"),
    ),
    forensicReportId: v.optional(v.id("forensicReports")),
    prUrl: v.optional(v.string()),
    fixSummary: v.optional(v.string()),
    autoFixAttempted: v.boolean(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_fingerprint", ["projectId", "fingerprint"]),

  // ─── REPO IMPORT JOBS ──────────────────────────────────────────────────────────
  importJobs: defineTable({
    projectId: v.id("projects"),
    repoUrl: v.string(),
    repoFullName: v.string(),
    branch: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("cloning"),
      v.literal("indexing"),
      v.literal("analyzing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    filesImported: v.optional(v.number()),
    detectedStack: v.optional(v.array(v.string())),
    briefGenerated: v.optional(v.boolean()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),
});

export default schema;
