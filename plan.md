# CodeForge V2 — Master Plan: Beyond Replit + Base44 + Cursor + Lovable

> **Vision:** CodeForge becomes the world's first autonomous software engineering
> platform — a live, browser-based environment where swarms of specialized AI
> agents plan, build, test, review, deploy, and iterate on production software
> with minimal human intervention. Not an assistant. A workforce.

---

## Competitive Landscape & Gap Analysis

| Capability | Replit | Base44 | Cursor | Lovable | CodeForge Today | CodeForge Target |
|---|---|---|---|---|---|---|
| Cloud IDE + preview | ✅ | ✅ | ❌ (local) | ✅ | ✅ | ✅ |
| AI chat → code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-agent orchestration | ❌ | ❌ | ❌ | ❌ | 🔶 (schema only) | ✅ Full swarm |
| Autonomous build loops | ❌ | ❌ | ❌ (manual) | ❌ | 🔶 (basic) | ✅ Self-healing |
| Git worktree isolation | ❌ | ❌ | ✅ (local) | ❌ | ❌ | ✅ |
| Session recovery / resume | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-provider agent backends | ❌ | ❌ | ❌ | ❌ | 🔶 (4 LLMs) | ✅ (agents + LLMs) |
| Real-time collaboration | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| One-click deploy | ✅ | ✅ | ❌ | ✅ | 🔶 (Vercel) | ✅ Multi-target |
| Prompt → full-stack app | 🔶 | ✅ | ❌ | ✅ | ❌ | ✅ |
| Codebase-aware intelligence | ❌ | ❌ | ✅ | ❌ | 🔶 (RAG) | ✅ Deep |
| Visual / no-code editing | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Cost tracking / budgets | ❌ | ❌ | ❌ | ❌ | 🔶 (schema) | ✅ Per-agent |
| Knowledge base / memory | ❌ | ❌ | ✅ (.cursorrules) | ❌ | 🔶 (RAG) | ✅ Persistent |
| Test generation + execution | ❌ | ❌ | 🔶 | ❌ | ❌ | ✅ |
| CI/CD pipeline generation | ❌ | ❌ | ❌ | ❌ | 🔶 (schema) | ✅ |

**Legend:** ✅ = production-ready | 🔶 = partial/stub | ❌ = absent

---

## Current State Assessment (Critical Findings)

### Architecture: Three Redundant Execution Engines

CodeForge has **three parallel agent engines** that accreted over time:

| Engine | File | Status | Verdict |
|---|---|---|---|
| v0 Build Loop | `convex/buildLoop.ts` | Complete but basic, no review/memory/verification | **Deprecate** |
| v1 Multi-Agent | `convex/agents.ts` | Production-used, sequential 9-agent pipeline + GitHub PR | **Deprecate** (merge useful parts) |
| v2 Tool-Loop Engine | `convex/engine.ts` | Most sophisticated: tool calls, Sentry, Debate, heal loop | **Canonical** — build on this |
| Spawn Engine | `convex/spawnEngine.ts` | Shard decomposition, but sequential + ignores agent roles | **Fix + integrate** |
| External Swarm | `convex/swarm.ts` | HTTP shim for Railway orchestrator, has agentId bug | **Fix + unify** |

### Critical Bugs to Fix First

1. **`swarm.ts` agentId mismatch** — `spawnAgent` stores `swarm:${taskId}:${role}:${uid}` but `updateAgentStatus` looks up `swarm:${taskId}:${uid}` → status updates never land.
2. **`rag.ts` operator precedence** — `... .length ?? 0 * 0.15` evaluates as `length ?? (0*0.15)` → tag weighting never applies.
3. **Category vocabulary mismatch** — `planner.ts`/`reflection.ts` emit `"infra"`, `"bug"`, `"security"` but `engine.executeWorkItem` checks `"infrastructure"`, `"ci"`, `"deploy"`, `"testing"` → most work items mis-route to generic coder.
4. **`codeReview.ts` fail-open** — On reviewer error, defaults to "approve" → security review failing silently approves code.
5. **`collaboration.joinByInvite`** — Returns projectId but never adds user as collaborator.
6. **`spawnEngine`** — Ignores per-shard `agentRole`; merge strategies declared but never implemented.

### The Mission Control Gap

**`src/pages/MissionControlPage.tsx` (1556 lines) is 100% hardcoded mock data.**
It calls zero Convex queries. Every constant (SUBTASKS, SWARM, LIVE_FEED, etc.)
is literal demo content. Meanwhile, the backend tables it should visualize
(`agentThoughts`, `agentTasks`, `toolCalls`, `agentMemories`,
`taskRetrospectives`, `workItems`, `codeReviews`) are fully populated by real
agent runs. **Wiring this page is the single highest-impact visible upgrade.**

### Missing Scheduling

`reflection.runNightlyReflection`, `runWeeklyStrategy`, and `monitorAndHeal`
are fully implemented but **never registered in `crons.ts`** — the
self-improvement and self-healing loops never run autonomously.

### Duplication to Consolidate

- BYOK `resolveByok` copy-pasted into ~7 files → extract to shared helper
- Two RAG systems (`rag.ts` keyword vs `swarm.ts` TF-bag) → consolidate
- Two memory query surfaces (`memory.ts` vs `intelligence.ts`) → unify
- Overlapping task/thought queries across modules → single source of truth

---

## What We're Porting from `autonomous-coder`

The `C:\autonomous-coder` repo (Express 5 + Drizzle + Supabase + React) is a
**production multi-agent platform with 21 specialized agent roles**, adversarial
debate, self-healing, real build verification, and a background task daemon.
These patterns translate directly to Convex:

### Core Orchestration

| autonomous-coder Pattern | CodeForge Adaptation |
|---|---|
| `superagent.ts` — task classifier (simple/moderate/complex/epic) | `convex/orchestrator.ts` — complexity router before dispatch |
| `spawnEngine.ts` — topological shard execution with DAG deps | Fix existing `convex/spawnEngine.ts` + add true parallelism |
| `agentWorker.ts` — worker with self-eval, retry, memory, event bus | Extend `convex/engine.ts` executeWorkItem heal loop |
| `agentPrompts.ts` — 21 specialized role prompts | `convex/agentRoles.ts` — expanded role registry |
| Serial→Parallel→Serial execution phases | Convex scheduler DAG with `Promise.all` batches |
| Smart model routing per agent role | Extend existing `ai.ts` `getModelForRole` |

### Intelligence & Learning

| autonomous-coder Pattern | CodeForge Adaptation |
|---|---|
| `debate.ts` — 3-agent adversarial debate (proponent/opponent/moderator) | Already partially in `engine.ts` Debate guard → expand to full system |
| `autoHeal.ts` — observe→diagnose→patch→learn loop | Wire `errorIngestion.ts` → `engine.executeWorkItem` automatically |
| `autoLearn.ts` — cross-session knowledge extraction | Fix existing `autoLearn.ts` (currently fed empty `filesChanged`) |
| `agentMemory.ts` — typed memory with scoring | Extend `convex/memory.ts` with importance-ranked retrieval |
| `webSearch.ts` — live research injection (Tavily + DuckDuckGo) | Extend existing `convex/webSearch.ts` with agent-type queries |

### Execution & Verification

| autonomous-coder Pattern | CodeForge Adaptation |
|---|---|
| `verify.ts` — real npm install + tsc + build + test in isolated dir | `convex/execution.ts` — WebContainer or Railway sidecar runner |
| `parallelRoutes.ts` — Node vm sandbox with 5s timeout | WebContainer-based sandbox (dependency already in package.json) |
| `delivery.ts` — auto-PR to GitHub + Slack notifications | Extend existing GitHub integration in `agents.ts` |
| `employeeWorker.ts` — background daemon polling for tasks | Convex `crons.ts` scheduled functions (built-in) |
| `providers.ts` — 10-provider cascading fallback chain | Already in `ai.ts` (14 providers) — add agent-level providers |

### Key Architectural Insight

> Convex's reactive subscriptions **eliminate the entire SSE infrastructure**.
> The autonomous-coder's `workerBus → SSE → useSandbox` chain (~400 lines of
> plumbing) becomes zero code: the frontend simply `useQuery`s a `workerJobs`
> table and gets real-time updates automatically. This is CodeForge's structural
> advantage — real-time by default, no polling, no WebSocket management.

---

## Phased Implementation Plan

### Phase -1: Critical Fixes & Consolidation (Week 1)

**Goal:** Fix broken things, eliminate redundancy, and establish `engine.ts` as
the single canonical execution path before building new features on top.

#### -1.1 — Bug Fixes (Day 1–2)

- [ ] Fix `swarm.ts` agentId format mismatch (include role segment in lookup)
- [ ] Fix `rag.ts` operator precedence: `(tags.length ?? 0) * 0.15`
- [ ] Fix category vocabulary: normalize `planner`/`reflection`/`engine` to one enum
- [ ] Fix `codeReview.ts`: default to "needs_changes" on reviewer error (fail-closed)
- [ ] Fix `collaboration.joinByInvite`: actually insert collaborator row
- [ ] Fix `spawnEngine`: pass `agentRole` through to `engine.runMission`

#### -1.2 — Engine Consolidation (Day 2–3)

- [ ] Designate `engine.ts` as the single canonical execution engine
- [ ] Extract useful parts of `agents.ts` (GitHub auto-PR, 9-agent roster) into engine
- [ ] Mark `buildLoop.ts` as deprecated (keep for backward compat, no new features)
- [ ] Unify `swarm.ts` external path to delegate to `engine.runMission`
- [ ] Extract shared `resolveByok` into `convex/lib/byok.ts` (single source)

#### -1.3 — Wire the Self-Healing Loop (Day 3–4)

- [ ] Register `reflection.monitorAndHeal` in `crons.ts` (interval: 5 min)
- [ ] Register `reflection.runNightlyReflection` in `crons.ts` (daily cron)
- [ ] Register `reflection.runWeeklyStrategy` in `crons.ts` (weekly cron)
- [ ] Fix `autoLearn.extractLearnings`: pass actual `filesChanged` from engine
- [ ] Wire `errorIngestion` → auto-dispatch `engine.executeWorkItem` for new incidents

#### -1.4 — Wire Mission Control to Real Data (Day 4–7)

Replace the 1556-line mock with live Convex queries:

- [ ] Swarm panel → `useQuery(api.swarm.getTaskAgents)` + `api.engine.listToolCalls`
- [ ] Live feed → `useQuery(api.agentThoughts.listRecent)` (real-time by default)
- [ ] Subtasks/Plan → `useQuery(api.planner.listWorkItems)` with status colors
- [ ] Memories → `useQuery(api.memory.listMemories)` (already exists)
- [ ] Retrospectives → `useQuery(api.memory.listRetrospectives)`
- [ ] Code reviews → `useQuery(api.codeReview.listReviews)`
- [ ] Cost gauge → `useQuery(api.intelligence.getCostSummary)` (fix to return real cost)
- [ ] Wire Pause/Resume/Rollback buttons to real mutations (not toasts)

---

### Phase 0: Foundation Hardening (Week 2–3)

**Goal:** Make the existing infrastructure production-reliable before building on it.

#### 0.1 — Complete the Swarm Schema

The `swarm` table exists but orchestration logic is HTTP-route-only with no
Convex-native coordination.

- [ ] Add `orchestratorState` field to swarm table: `"planning" | "dispatching" | "monitoring" | "aggregating" | "complete" | "failed"`
- [ ] Add `parentTaskId` to swarm for hierarchical task trees
- [ ] Add `worktreePath` field for isolated execution contexts
- [ ] Add `provider` field: `"internal" | "openhands" | "codex" | "gemini" | "copilot" | "claude"`
- [ ] Add `costBudget` and `costSpent` fields per agent
- [ ] Add `recoveryLog` field (array of checkpoint references)
- [ ] Index: `by_session_and_status`, `by_parent_task`

#### 0.2 — Unified AI Provider Layer

Refactor `convex/ai.ts` into a proper provider abstraction (ported from
autonomous-coder's `server/providers/`):

- [ ] Create `convex/providers/types.ts` — `AgentProvider` interface:
  ```ts
  interface AgentProvider {
    id: string;
    name: string;
    capabilities: ("code" | "plan" | "review" | "test" | "deploy")[];
    maxContextTokens: number;
    supportsStreaming: boolean;
    execute(task: AgentTask): Promise<AgentResult>;
    estimateCost(task: AgentTask): CostEstimate;
  }
  ```
- [ ] Implement providers: `internal` (existing callAI), `openhands`, `codex`, `gemini-cli`, `claude-code`
- [ ] Provider selection: auto-route by task type, cost budget, and availability
- [ ] Fallback chains: if primary provider fails, cascade to next

#### 0.3 — Error Ingestion → Self-Healing Pipeline

`convex/errorIngestion.ts` exists but isn't wired to the build loop.

- [ ] Wire error ingestion to trigger automatic fix attempts
- [ ] Classify errors: `syntax | runtime | dependency | logic | config | flaky`
- [ ] Auto-retry with context enrichment (include error + surrounding code)
- [ ] Escalation: after 3 failed attempts, create a human-review task
- [ ] Track fix success rate per error class for learning

---

### Phase 1: The Orchestrator Brain (Week 2–4)

**Goal:** A planning engine that decomposes any user request into an executable
DAG of agent tasks — the core differentiator.

#### 1.1 — Task Decomposition Engine (`convex/orchestrator.ts`)

Port and extend autonomous-coder's orchestrator:

- [ ] `decompose(request, context)` — LLM-powered planning that produces:
  ```ts
  interface TaskPlan {
    id: string;
    title: string;
    description: string;
    type: "code" | "test" | "review" | "refactor" | "deploy" | "research" | "docs";
    dependencies: string[];  // task IDs that must complete first
    estimatedTokens: number;
    provider: string;        // preferred provider
    files: string[];         // files this task will touch
    acceptanceCriteria: string[];
  }
  ```
- [ ] Dependency graph validation (cycle detection, parallelism analysis)
- [ ] Critical path computation for optimal scheduling
- [ ] Re-planning on failure: if a task fails, re-decompose downstream tasks

#### 1.2 — Task Queue & Scheduler (`convex/taskQueue.ts`)

- [ ] Priority queue with aging (starvation prevention)
- [ ] Concurrency control: max N agents per project (configurable)
- [ ] Resource-aware scheduling: don't schedule conflicting file edits in parallel
- [ ] Dependency gating: task starts only when all deps are `completed`
- [ ] Cron-driven tick: `convex/crons.ts` interval(10s) processes the queue
- [ ] Dead-letter queue for permanently failed tasks

#### 1.3 — Agent Specialization (`convex/agentRoles.ts`)

Port and expand autonomous-coder's 21-role system with smart model routing:

| Role | Specialty | Model Tier | Execution Phase |
|---|---|---|---|
| **Orchestrator** | Decomposition, sequencing, coordination | Heavy reasoning | Serial (start) |
| **Strategist** | Architecture planning, tech selection | Heavy reasoning | Serial (start) |
| **Architect** | System design, file structure, API contracts | Heavy reasoning | Serial (start) |
| **Researcher** | Docs, API references, live web research | Web-search capable | Parallel (early) |
| **Database** | Schema design, migrations, queries | Code-specialized | Parallel (mid) |
| **API** | Backend endpoints, business logic | Code-specialized | Parallel (mid) |
| **UI** | Frontend components, styling, UX | Code-specialized | Parallel (mid) |
| **Builder** | Integration, glue code, implementation | Fast code model | Serial (mid) |
| **Tester** | Unit + integration test generation | Fast model | Parallel (late) |
| **Security** | Vulnerability scanning, auth review | High-reasoning | Parallel (late) |
| **Performance** | Profiling, optimization, bundle size | Fast model | Parallel (late) |
| **Reviewer** | Code quality, style, best practices | High-reasoning | Serial (end) |
| **Fixer** | Bug fixing, patch application | Fast + cheap | Serial (end) |
| **Debugger** | Runtime error diagnosis and repair | Fast + cheap | On-demand |
| **Deployer** | CI/CD, deployment config, DNS | Deterministic | On-demand |
| **Refactorer** | Cleanup, migration, deduplication | High-reasoning | On-demand |
| **Docs** | README, API docs, comments | Creative model | On-demand |
| **SEO** | Meta tags, structured data, sitemap | Creative model | On-demand |
| **A11y** | Accessibility audit and fixes | Creative model | On-demand |
| **Optimizer** | Image/font/perf optimization | Fast model | On-demand |
| **Analyst** | Root cause analysis, forensics | Heavy reasoning | On-demand |

**Execution phases** (ported from autonomous-coder's serial-parallel-serial):
1. **Serial start:** Orchestrator → Strategist → Architect (planning)
2. **Debate gate:** Adversarial review of the plan (Phase 6.3)
3. **Parallel mid:** Database + API + UI (independent, run concurrently)
4. **Serial builder:** Builder (needs all prior context merged)
5. **Parallel end:** Testing + Security + Performance (independent)
6. **Serial end:** Reviewer → Fixer (quality gate)

- [ ] Each role has: system prompt template, tool access list, token budget, model preference
- [ ] Smart routing: `getModelForRole()` maps roles to optimal models (heavy→Gemini/Claude, fast→DeepSeek Flash/Grok, creative→Kilo auto)
- [ ] Role assignment: orchestrator assigns roles based on task type + complexity
- [ ] Role escalation: Builder can request Architect review for complex changes
- [ ] Context accumulation: each agent's output merges into shared context for downstream agents

#### 1.4 — Planning UI (Mission Control upgrade)

- [ ] Visual DAG renderer: show task graph with status colors
- [ ] Real-time agent activity feed (who's doing what, right now)
- [ ] Intervention points: pause, redirect, approve/reject at gates
- [ ] Cost dashboard: per-agent, per-task, per-session burn rate
- [ ] Timeline view: Gantt-style execution history

---

### Phase 2: Isolated Execution Environments (Week 4–6)

**Goal:** Each agent works in its own sandboxed context — no conflicts, full
rollback capability.

#### 2.1 — Git Worktree Management (`convex/worktrees.ts`)

Port from autonomous-coder's `server/git.ts`:

- [ ] Create worktree per agent session: `.codeforge/worktrees/agent-<id>/`
- [ ] Branch naming: `codeforge/<mission-slug>/<agent-role>-<n>`
- [ ] Auto-cleanup: remove worktrees for completed/abandoned sessions
- [ ] Conflict detection: warn if two agents touch the same file
- [ ] Merge strategy: orchestrator merges completed branches in dependency order

#### 2.2 — Sandboxed Code Execution

- [ ] WebContainer-based execution (already have `@webcontainer/api` dependency)
- [ ] Per-agent WebContainer instance for running/testing code
- [ ] Resource limits: CPU time, memory, network access per agent
- [ ] Snapshot/restore: checkpoint container state for recovery
- [ ] Output capture: stdout, stderr, exit codes fed back to agent context

#### 2.3 — File System Virtualization

- [ ] Overlay file system: agents see project files + their worktree changes
- [ ] Write-ahead log: every file mutation is logged before applying
- [ ] Conflict-free merge: CRDT-based or last-writer-wins with review gate
- [ ] File locking: optimistic locking with conflict resolution UI

---

### Phase 3: Session Recovery & Resilience (Week 6–7)

**Goal:** No work is ever lost. Any crash, disconnect, or failure resumes
seamlessly.

#### 3.1 — Event Sourcing (`convex/recovery.ts`)

Port autonomous-coder's session recovery pattern:

- [ ] Every agent action emits an event: `{ sessionId, seq, type, payload, timestamp }`
- [ ] Events stored in `sessionEvents` table (append-only)
- [ ] Recovery: replay events to reconstruct agent state at any point
- [ ] Checkpointing: periodic state snapshots for fast recovery (every N events)
- [ ] Cross-device resume: user switches browser → session continues

#### 3.2 — Agent Heartbeat & Health

- [ ] Heartbeat interval: agents report alive every 5s
- [ ] Stale detection: if no heartbeat for 30s, mark agent as `stale`
- [ ] Auto-restart: respawn stale agents with recovered context
- [ ] Circuit breaker: if an agent fails 3x on the same task, quarantine it
- [ ] Health dashboard: real-time view of all agent vitals

#### 3.3 — Graceful Degradation

- [ ] If orchestrator LLM is down: fall back to simpler decomposition
- [ ] If a provider is down: auto-reroute to backup provider
- [ ] If Convex is rate-limited: queue mutations, batch writes
- [ ] Partial results: if a swarm is interrupted, completed tasks are preserved

---

### Phase 4: Deep Code Intelligence (Week 7–9)

**Goal:** Surpass Cursor's codebase understanding with persistent, evolving
project knowledge.

#### 4.1 — Project Knowledge Graph (`convex/knowledgeGraph.ts`)

- [ ] Parse project into entities: modules, classes, functions, types, routes
- [ ] Relationship mapping: imports, calls, inherits, implements
- [ ] Dependency graph: which files affect which (change impact analysis)
- [ ] Auto-update: re-parse on every file change (incremental)
- [ ] Query interface: "what calls this function?", "what breaks if I change X?"

#### 4.2 — Enhanced RAG (extend `convex/rag.ts`)

- [ ] Chunk strategy: AST-aware chunking (not just line-based)
- [ ] Multi-granularity: file-level, function-level, module-level embeddings
- [ ] Temporal awareness: weight recent changes higher
- [ ] Cross-project learning: patterns from user's other projects (opt-in)
- [ ] Hybrid search: embedding similarity + keyword + graph traversal

#### 4.3 — Codebase-Aware Completions

- [ ] Context assembly: relevant files + types + recent changes + conventions
- [ ] Convention detection: infer style from existing code (naming, patterns)
- [ ] `.codeforge/conventions.json` — project-specific rules (like .cursorrules)
- [ ] Auto-learning: observe user edits to refine suggestions (extend `autoLearn.ts`)

#### 4.4 — Multi-File Intelligent Editing

- [ ] Atomic multi-file edits: plan touches N files, applied as one unit
- [ ] Type-aware refactoring: rename propagates through imports/usage
- [ ] Migration generation: schema change → migration script → code updates
- [ ] Rollback: any multi-file edit can be reverted atomically

---

### Phase 5: Prompt-to-Production Pipeline (Week 9–11)

**Goal:** Surpass Lovable/Base44 — user describes an app, CodeForge delivers a
deployed, tested, production-ready product.

#### 5.1 — Full-Stack App Generation

- [ ] Requirement extraction: LLM parses natural language → structured spec
- [ ] Architecture selection: choose stack based on requirements
- [ ] Schema design: generate database schema from entities/relationships
- [ ] API generation: CRUD + business logic from schema + requirements
- [ ] UI generation: component tree from feature descriptions
- [ ] Auth scaffolding: auto-configure auth based on requirements
- [ ] Test generation: unit + integration tests for all generated code

#### 5.2 — Iterative Refinement Loop

- [ ] User feedback integration: "make the button blue" → targeted edit
- [ ] Screenshot comparison: render UI, compare to user's vision
- [ ] A/B generation: produce 2-3 variants, let user pick
- [ ] Progressive enhancement: start minimal, add features incrementally
- [ ] Regression protection: each iteration runs existing tests

#### 5.3 — Visual Editing Layer

- [ ] Click-to-edit: click any UI element to modify it
- [ ] Drag-and-drop layout adjustments
- [ ] Style panel: colors, spacing, typography without code
- [ ] Component inspector: see/edit props, state, events visually
- [ ] Responsive preview: mobile/tablet/desktop side-by-side

#### 5.4 — One-Click Deploy Pipeline

- [ ] Target selection: Vercel, Railway, Netlify, Cloudflare, AWS
- [ ] Auto-configure: generate deployment config for chosen target
- [ ] Environment management: secrets, env vars, database provisioning
- [ ] Custom domain: DNS setup guidance + SSL
- [ ] Rollback: one-click revert to previous deployment
- [ ] Monitoring: post-deploy health checks + error alerting

---

### Phase 6: Swarm Intelligence & Learning (Week 11–13)

**Goal:** The system gets smarter with every use. Agents learn from successes
and failures.

#### 6.1 — Reflection & Self-Improvement (extend `convex/reflection.ts`)

- [ ] Post-mission analysis: what worked, what failed, what was slow
- [ ] Pattern extraction: "for React projects, always add error boundaries"
- [ ] Prompt evolution: A/B test system prompts, keep winners
- [ ] Failure taxonomy: classify and learn from recurring failures
- [ ] Success metrics: track code quality scores over time

#### 6.2 — Cross-Session Memory (extend `convex/memory.ts`)

- [ ] Project memory: decisions made, conventions established, gotchas found
- [ ] User preferences: coding style, preferred libraries, communication style
- [ ] Team knowledge: shared learnings across collaborators
- [ ] Semantic recall: "last time we fixed a similar bug, we did X"
- [ ] Forgetting: decay irrelevant memories, prune stale knowledge

#### 6.3 — Agent Collaboration Protocols

- [ ] Peer review: Builder's output reviewed by Reviewer before merge
- [ ] Debate mode: two agents argue architecture decisions, Orchestrator decides
- [ ] Pair programming: two agents on one task (driver + navigator)
- [ ] Escalation chains: Debugger → Builder → Architect for hard problems
- [ ] Consensus: multiple agents vote on ambiguous decisions

#### 6.4 — Benchmarking & Quality Gates

- [ ] Extend `convex/benchmark.ts`: run generated code against test suites
- [ ] Quality score: complexity, coverage, performance, security
- [ ] Regression detection: compare before/after metrics
- [ ] Human-in-the-loop gates: configurable approval points
- [ ] SLA tracking: time-to-completion, fix-rate, user satisfaction

---

### Phase 7: Developer Experience & Scale (Week 13–16)

**Goal:** Make it feel magical. Remove all friction.

#### 7.1 — IDE Enhancements

- [ ] AI inline completions (ghost text, Tab to accept)
- [ ] Command palette AI: `Ctrl+K` → natural language edit
- [ ] Error lens: AI explanation + fix suggestion inline
- [ ] Terminal integration: agents can run commands, user sees output
- [ ] Multi-cursor AI: edit multiple locations simultaneously
- [ ] Code actions: "extract component", "add tests", "optimize"

#### 7.2 — Collaboration Features

- [ ] Multiplayer cursors: see collaborators editing in real-time
- [ ] Agent visibility: see what each AI agent is doing live
- [ ] Comment threads: discuss changes inline (human + AI)
- [ ] Role-based access: owner, editor, viewer, AI-agent
- [ ] Session replay: watch a mission execute from start to finish

#### 7.3 — Performance at Scale

- [ ] Virtual file system: handle 100k+ file projects
- [ ] Incremental parsing: only re-analyze changed files
- [ ] Web Worker offloading: heavy computation off main thread
- [ ] Convex pagination: never load entire tables
- [ ] Agent pooling: reuse warm agents across tasks
- [ ] Predictive prefetch: load files an agent will likely need

#### 7.4 — Extensibility

- [ ] Plugin system: custom agent roles, tools, providers
- [ ] MCP integration: connect external tool servers
- [ ] Custom workflows: user-defined orchestration pipelines
- [ ] API access: programmatic swarm control
- [ ] Webhook triggers: GitHub PR → auto-review swarm

---

### Phase 8: Enterprise & Monetization (Week 16–20)

**Goal:** Revenue-ready platform with enterprise features.

#### 8.1 — Team & Organization Features

- [ ] Organization accounts with shared billing
- [ ] Project templates: team-standard starters
- [ ] Shared knowledge base: org-wide conventions and patterns
- [ ] Audit log: every agent action, every deployment
- [ ] SSO/SAML: enterprise auth integration

#### 8.2 — Usage-Based Pricing Infrastructure

- [ ] Per-agent-minute billing
- [ ] Token usage tracking per provider
- [ ] Compute credits for sandboxed execution
- [ ] Storage quotas for projects and artifacts
- [ ] Usage dashboard with cost attribution

#### 8.3 — Compliance & Security

- [ ] SOC 2 readiness: audit trails, access controls
- [ ] Data residency: region selection for storage
- [ ] Secret scanning: never commit credentials
- [ ] Dependency auditing: CVE detection in generated code
- [ ] IP protection: code never used for training (guarantee)

---

## Technical Architecture (Target State)

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
│  Monaco IDE │ Mission Control │ Visual Editor │ Deploy Console   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Convex Reactive Queries (real-time)
┌──────────────────────────────┴──────────────────────────────────┐
│                      CONVEX BACKEND                              │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Orchestrator│──│  Task Queue  │──│   Agent Scheduler      │ │
│  │ (planning)  │  │  (priority)  │  │   (concurrency ctrl)   │ │
│  └──────┬──────┘  └──────────────┘  └───────────┬────────────┘ │
│         │                                        │              │
│  ┌──────┴──────────────────────────────────────┐ │              │
│  │           PROVIDER LAYER                     │ │              │
│  │  Internal │ OpenHands │ Codex │ Gemini │ Claude │           │
│  └─────────────────────────────────────────────┘ │              │
│                                                   │              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐│              │
│  │ Knowledge  │  │  Recovery  │  │  Execution  ││              │
│  │   Graph    │  │  (events)  │  │  (sandbox)  ││              │
│  └────────────┘  └────────────┘  └─────────────┘│              │
│                                                   │              │
│  ┌────────────────────────────────────────────────┘              │
│  │  SWARM TABLE: agents, tasks, sessions, worktrees             │
│  └──────────────────────────────────────────────────────────────│
└──────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                    EXECUTION LAYER                               │
│  WebContainers │ Git Worktrees │ Deploy Targets │ CI Runners     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

| Metric | Current | 3-Month Target | 6-Month Target |
|---|---|---|---|
| Time from prompt → deployed app | N/A | < 5 min (simple) | < 2 min |
| Autonomous fix rate (no human) | ~0% | 60% | 85% |
| Multi-file edit success rate | N/A | 70% | 90% |
| Agent task completion rate | N/A | 75% | 92% |
| Session recovery success | 0% | 95% | 99% |
| Code quality score (generated) | N/A | 7/10 | 8.5/10 |
| Concurrent agents per project | 0 | 5 | 15 |
| User interventions per mission | N/A | < 3 | < 1 |

---

## Immediate Next Steps (This Week — Phase -1)

**Day 1–2: Fix what's broken**
1. Fix `swarm.ts` agentId mismatch (status updates never land)
2. Fix `rag.ts` operator precedence bug (tag weighting dead code)
3. Normalize category vocabulary across planner/reflection/engine
4. Fix `codeReview.ts` fail-open → fail-closed
5. Fix `collaboration.joinByInvite` to actually grant membership

**Day 2–3: Consolidate engines**
6. Designate `engine.ts` as canonical; deprecate `buildLoop.ts`
7. Extract shared BYOK resolver into `convex/lib/byok.ts`
8. Unify `swarm.ts` external path to delegate to engine

**Day 3–4: Activate the autonomous loop**
9. Register reflection/self-heal crons in `crons.ts`
10. Fix `autoLearn` to receive actual `filesChanged`
11. Wire `errorIngestion` → automatic `executeWorkItem` dispatch

**Day 4–7: Wire Mission Control**
12. Replace all mock data in `MissionControlPage.tsx` with live Convex queries
13. Connect Pause/Resume/Rollback to real backend mutations
14. Add real-time agent activity feed via `agentThoughts` subscription

---

## Files to Create (New)

```
convex/orchestrator.ts      — Task decomposition + planning engine
convex/taskQueue.ts         — Priority queue + scheduler
convex/agentRoles.ts        — Specialized agent personas
convex/providers/types.ts   — Provider interface
convex/providers/internal.ts
convex/providers/openhands.ts
convex/providers/codex.ts
convex/providers/gemini.ts
convex/providers/claude.ts
convex/worktrees.ts         — Git worktree management
convex/recovery.ts          — Event sourcing + session recovery
convex/knowledgeGraph.ts    — Project structure graph
convex/execution.ts         — Sandboxed code execution
convex/qualityGates.ts      — Benchmarking + quality scoring
src/components/MissionControl/TaskGraph.tsx
src/components/MissionControl/AgentFeed.tsx
src/components/MissionControl/CostDashboard.tsx
src/components/VisualEditor/
src/components/DeployConsole/
```

## Files to Modify (Existing)

```
convex/schema.ts            — New tables + fields
convex/swarm.ts             — Full orchestration logic
convex/buildLoop.ts         — Wire to orchestrator
convex/ai.ts                — Refactor into provider layer
convex/crons.ts             — Add scheduler tick
convex/rag.ts               — AST-aware chunking
convex/reflection.ts        — Post-mission learning
convex/memory.ts            — Cross-session persistence
convex/errorIngestion.ts    — Self-healing pipeline
convex/costEntries.ts       — Per-agent cost tracking
src/pages/MissionControlPage.tsx — Full DAG UI
```

---

## Key Principles

1. **Agents are workers, not chatbots.** They execute tasks autonomously within
   defined boundaries. Humans set goals; agents deliver results.

2. **Isolation by default.** Every agent gets its own branch, its own sandbox,
   its own context. No shared mutable state between agents.

3. **Recovery is not optional.** Every action is logged. Every state is
   reconstructible. Crashes are invisible to the user.

4. **Cost-aware intelligence.** Route simple tasks to cheap models. Reserve
   expensive reasoning for architecture and debugging. Track every token.

5. **Progressive autonomy.** Start with human-in-the-loop at every gate.
   Earn trust by succeeding. Gradually remove gates as confidence grows.

6. **The platform learns.** Every mission makes the next one faster, cheaper,
   and higher quality. Knowledge compounds.
