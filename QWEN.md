# QWEN.md

Context file for AI coding agents working in this repository.

## Project Overview

**CodeForge V2** is an AI-powered coding platform with multi-model chat, live
in-browser preview, multi-agent build mode, and real-time collaboration. Users
create projects, edit code in a Monaco-based IDE, chat with AI models, and
autonomously build full applications — all backed by Convex for real-time
state, auth, and serverless functions.

**Live:** [code.donmatthews.live](https://code.donmatthews.live)

CodeForge's autonomous build system is architecturally comparable to
**Replit Agent**, **Base44**, and **Cursor** — it decomposes user goals into
DAGs of specialized agent tasks, executes them via a tool-calling loop, and
can parallelize epic builds across independent shards. The key difference:
CodeForge uses a **multi-provider model registry with automatic fallback
chains** spanning 15+ AI providers, so a single provider outage never blocks
the build pipeline.

### Tech Stack

| Layer      | Technology                                                        |
| ---------- | ----------------------------------------------------------------- |
| Frontend   | React 19, TypeScript (strict), Vite 7, Tailwind CSS v4, shadcn/ui |
| Editor     | Monaco Editor (`@monaco-editor/react`)                            |
| Routing    | React Router v7                                                   |
| Backend    | Convex 1.41 (real-time DB, auth, serverless functions, HTTP)      |
| Auth       | `@convex-dev/auth` with email OTP (Resend)                        |
| Payments   | Stripe                                                            |
| Lint/Fmt   | Biome (replaces ESLint + Prettier)                                |
| Unit Tests | Vitest + `convex-test` (edge-runtime environment)                 |
| E2E/Smoke  | Playwright + Bun (`scripts/`)                                     |

## Autonomous Build System

This is the core differentiator — the system that lets CodeForge build
applications from natural-language prompts the way Replit Agent, Base44, and
Cursor do. All logic lives in `convex/`.

### Architecture Overview

```
User prompt
    │
    ▼
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Orchestrator │───▶│  Agent Roles  │───▶│   Engine     │
│  (plan DAG)  │    │ (21 personas) │    │ (tool loop)  │
└──────────────┘    └───────────────┘    └──────┬───────┘
                                                │
                    ┌───────────────────────────┼───────────────┐
                    ▼                           ▼               ▼
              ┌──────────┐              ┌─────────────┐  ┌────────────┐
              │SpawnEngine│              │  AI Router  │  │  Sentry +  │
              │(shard fan)│              │ (fallback)  │  │  Debate    │
              └──────────┘              └─────────────┘  └────────────┘
```

### AI Router — Model Registry & Fallback (`convex/ai.ts`)

The central AI dispatch layer. Every agent call goes through
`callAIWithFallback()`, which tries the requested model then walks a
provider-diverse fallback chain so a single provider's rate limit, quota, or
outage never surfaces "all models failed" to the user.

**Key exports:**

| Export | Purpose |
|--------|---------|
| `MODELS` | Registry of 30+ models across 15 providers with cost/tier metadata |
| `DEFAULT_MODEL` | `"cerebras-gpt-oss-120b"` — free, strong, generous daily quota |
| `AGENT_MODELS` | Per-role default model map (all Cerebras/Groq free-tier) |
| `MODEL_PROFILES` | Named profiles: `dons_pick`, `free`, `budget`, `premium`, `reasoning`, `speed` |
| `callAI()` | Single AI call with BYOK gating, prompt truncation for small-context models |
| `callAIWithFallback()` | Fallback-chain wrapper — the universal entry point |
| `getModelForRole()` | Resolves model for a role: user's chat-panel pick > profile > AGENT_MODELS |
| `checkByokRequirement()` | Gates lifetime users — must supply own keys |

**Current live model registry** (verified July 2026):

| Provider | Models | Notes |
|----------|--------|-------|
| **Cerebras** | `cerebras-glm-4.7`, `cerebras-gpt-oss-120b` | Free tier (~1M tok/day), fastest inference |
| **Groq** | `groq-llama-3.3-70b`, `groq-gpt-oss-120b`, `groq-gpt-oss-20b`, `groq-qwen3-32b`, `groq-llama-3.1-8b` | Free tier, per-model TPM caps |
| **Qwen Cloud** | `qwen-cloud-max`, `qwen-cloud-coder`, `qwen-cloud-deepseek`, `qwen-cloud-flash` | Paid (Alibaba Model Studio), token-plan endpoint |
| **Cohere** | `cohere-command-r-plus` | Production tier, OpenAI-compatible endpoint |
| **Mistral** | `mistral-codestral` | Free tier, dedicated coding model |
| **GitHub Models** | `github-gpt-4.1`, `github-codestral`, `github-llama-4-maverick` | Free via GitHub PAT, tight token caps |
| **OpenRouter** | `or-gpt-oss-20b-free`, `or-nemotron-3-super-free` | Free-tier models |
| **Kilo Code** | `kilocode-qwen3-coder`, `kilocode-llama-3.3-70b` | Free tier via `kilo.ai` gateway |
| **Anthropic** | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` | Premium profile only |
| **DeepSeek** | `deepseek-v3`, `deepseek-chat`, `deepseek-reasoner` | Paid — confirmed "Insufficient Balance" on this deployment |
| **xAI** | `grok-3-fast`, `grok-4` | Premium profile |
| **Moonshot** | `kimi-k2` | Cheap utility tier |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o` | Fallback last resort |
| **Google** | `gemini-2.5-flash`, `gemini-2.0-flash` | Large context, generous free tier |

**Fallback chain order** (in `callAIWithFallback`):
requested model → Qwen Cloud (paid, reliable) → Groq models (free, separate
quotas) → Cerebras (free) → Cohere → Mistral → GitHub Models → OpenRouter
free → paid last resort (Kimi, GPT-4o-mini). Lifetime (BYOK) users: chain is
filtered to only models their supplied keys can serve.

### Agent Roles (`convex/agentRoles.ts`)

21 specialized agent personas, each with a tuned system prompt, tool access
list, token budget, model tier preference, and execution phase:

| Role | Icon | Model Tier | Phase | Specialty |
|------|------|-----------|-------|-----------|
| orchestrator | 🧠 | heavy | serial-start | Decomposes goals into task DAGs, coordinates agents |
| strategist | 🎯 | heavy | serial-start | Architecture, technology selection, ADRs |
| architect | 🏗️ | heavy | serial-start | System design, file structure, API contracts |
| researcher | 🔬 | creative | parallel-early | Investigates libraries, patterns, solutions |
| database | 🗄️ | code | parallel-early | Schema design, migrations, query optimization |
| api | 🔌 | code | parallel-early | API endpoints, middleware, server logic |
| ui | 🎨 | creative | parallel-mid | Components, layouts, responsive design |
| builder | 🔨 | code | parallel-mid | Feature implementation, integration |
| tester | 🧪 | code | parallel-mid | Unit/integration tests, test infrastructure |
| security | 🛡️ | fast | serial-mid | Security audit, vulnerability scanning |
| performance | ⚡ | fast | serial-mid | Profiling, optimization, bottleneck analysis |
| reviewer | 🔎 | code | parallel-late | Code quality, best practices |
| fixer | 🔧 | code | parallel-late | Bug fixes, error handling, edge cases |
| debugger | 🐛 | code | parallel-late | Root cause analysis, diagnostics |
| deployer | 🚀 | deterministic | serial-end | CI/CD, deployment, infrastructure |
| refactorer | ♻️ | code | on-demand | Code restructuring, debt reduction |
| docs | 📝 | fast | on-demand | Documentation generation |
| seo | 📈 | fast | on-demand | SEO optimization, meta tags |
| a11y | ♿ | fast | on-demand | Accessibility compliance |
| optimizer | ⚡ | fast | on-demand | Performance tuning |
| analyst | 📊 | creative | on-demand | Data analysis, reporting |

**Model tiers → profile routing:** `heavy`→Cohere/Anthropic, `code`→Cerebras,
`fast`→Groq, `creative`→auto, `deterministic`→lowest temperature.

### v2 Tool-Calling Engine (`convex/engine.ts`)

The canonical execution engine (supersedes deprecated `buildLoop.ts`).
Agents use **structured tool calls**, not text parsing:

```
AI returns JSON tool calls → engine executes tools → results feed back → AI continues
```

**Available tools:**

| Tool | Purpose |
|------|---------|
| `create_file` | Create or update a project file |
| `edit_file` | Edit an existing file |
| `delete_file` | Delete a file (requires Debate approval) |
| `read_file` | Read file contents |
| `list_files` | List all project files |
| `search_files` | RAG-powered semantic search |
| `get_context` | Assemble context for the AI prompt |
| `web_search` | Search the web for information |
| `spawn_agent` | Spawn a sub-agent with a specific role |
| `spawn_epic` | Trigger SpawnEngine for epic-complexity tasks |
| `send_message` | Inter-agent communication |
| `deploy_project` | Deploy the project |
| `complete_task` | Mark the current task as done |

Every tool call passes through **Sentry** (safety check) and optionally
**Debate** (guardrail for destructive/sensitive operations) before execution.

### Orchestrator — Task Decomposition & Dispatch (`convex/orchestrator.ts`)

The brain of the autonomous swarm:

1. **Classifies complexity** — simple → moderate → complex → epic
2. **Decomposes into a DAG** of specialized agent tasks with dependency edges
3. **Creates an `orchestratorSession`** to track lifecycle (planning →
   dispatching → monitoring → aggregating → complete/failed)
4. **Dispatches tasks** respecting dependency order and parallelism factor
5. **Monitors progress** and re-plans on failure

### Spawn Engine — Parallel Shard Decomposition (`convex/spawnEngine.ts`)

Scales CodeForge from "build a button" to "build a full SaaS platform". For
epic-complexity tasks:

1. **Plans decomposition** into independent shards (Data Layer, API Layer,
   UI Components, etc.)
2. **Topological sort** determines execution order
3. **Independent shards run in parallel** via the agent engine
4. **Completed shard context feeds forward** to dependent shards
5. **Merge** outputs via configurable strategy (concatenate, reconcile, layer)

### Planner — ACSE (`convex/planner.ts`)

The Autonomous Software Completion Engine (Phase 3). Converts X-Ray findings
and completion scores into a dependency-aware execution DAG of work items with
priority, impact, effort, and risk estimates.

### Provider System — External Runtimes (`convex/providers/types.ts`)

Unified `AgentProvider` interface that can route to external agent runtimes in
addition to internal LLM calls:

| Provider ID | Name | Capabilities |
|-------------|------|--------------|
| `internal` | CodeForge (Cerebras/Groq/Qwen/etc.) | code, plan, review, test, debug, research |
| `claude-code` | Claude Code (Anthropic) | code, plan, review, test, debug, deploy |
| `gemini-cli` | Gemini CLI (Google) | code, plan, review, research, debug |
| `codex` | Codex CLI (OpenAI) | code, test, debug, deploy |
| `openhands` | OpenHands (Self-hosted) | code, test, debug, deploy, research |
| `copilot` | GitHub Copilot CLI | code, review, debug |

Provider selection considers task type, cost budget, availability, and BYOK
keys via `selectProvider()`.

### Swarm — Railway Orchestrator (`convex/swarm.ts`)

HTTP-callable mutations/queries for the external Railway orchestrator
process. All endpoints authenticated via `RAILWAY_ORCHESTRATOR_SECRET` Bearer
token. Manages swarm task queue, sub-agent spawning, and status reporting.

### Safety Guardrails

| Guardrail | File | Purpose |
|-----------|------|---------|
| **Sentry** | `convex/sentry.ts` | Pre-execution safety check on every tool call — blocks dangerous operations, flags sensitive paths |
| **Debate** | `convex/debate.ts` | Multi-agent debate approval for destructive operations (file deletion, sensitive path access) |
| **Reflection** | `convex/reflection.ts` | Self-healing: monitors agent output, re-plans on failure, nightly reflection cycle (currently disabled — free-tier limits) |

### v1 Multi-Agent Pipeline (`convex/agents.ts`)

The sequential 9-agent pipeline (Planner → UI → Mobile → Logic → Debug →
Feature → Test → Reviewer → QA) with GitHub auto-PR. Still functional but
`engine.ts` (v2) is the canonical path for new work.

### Model Profile Selection

Users select an AI profile in Settings. `getModelForRole()` resolves models
in this priority:

1. **User's chat-panel model pick** — if set on the project's latest
   `chatSession`, overrides everything (the model picker has no "Automatic"
   option; every choice is a concrete model id)
2. **Profile-based routing** — `MODEL_PROFILES[profile]` keyed by role
3. **`AGENT_MODELS`** — hardcoded per-role defaults
4. **`DEFAULT_MODEL`** — `cerebras-gpt-oss-120b`

Active profiles:

| Profile | Orchestrator | Coder | Notes |
|---------|-------------|-------|-------|
| `dons_pick` | Cohere R+ | Cerebras GPT-OSS 120B | Default — no free-tier rate walls |
| `free` | Groq Llama 3.3 70B | Mistral Codestral | All free-tier models |
| `budget` | Groq Llama 3.3 70B | Groq Llama 3.3 70B | Fast + cheap |
| `premium` | Claude Opus 4.8 | Claude Sonnet 4.6 | Anthropic throughout |
| `reasoning` | DeepSeek R1 | DeepSeek V3 | Deep reasoning |
| `speed` | Groq Llama 3.3 70B | Groq Llama 3.1 8B | Fastest possible |

## Building and Running

```sh
npm ci                 # Install dependencies
npx convex dev         # Start Convex backend + codegen watch (sets VITE_CONVEX_URL)
npm run dev            # Vite dev server with HMR
npm run build          # Production build (requires convex/_generated)
npm run preview        # Preview production build on port 4173
```

> **Note:** `npm install` uses `--legacy-peer-deps` in production builds
> (see `nixpacks.toml`). Locally, `npm ci` should work, but if you hit peer
> dependency conflicts, use `npm install --legacy-peer-deps`.

Convex is a hard dependency — there is no offline fallback. Every environment
requires `VITE_CONVEX_URL`.

### Type Checking

Two separate TypeScript projects must both pass — the root `tsconfig.json`
does not include `convex/`:

```sh
npx tsc -b                        # App + Node configs (root tsconfig)
npx tsc -p convex/tsconfig.json   # Convex functions (separate tsconfig)
```

### Linting & Formatting

```sh
npx biome check .              # Lint + format check
npx biome check --write .      # Auto-fix
npx biome format . --write     # Format only
```

Biome config (`biome.json`) enforces: 2-space indent, 80-char width, double
quotes, semicolons, arrow parens as-needed, organize imports on save. Ignores:
`scripts/`, `convex/_generated/`, `dist/`.

### Testing

Unit tests (Vitest, edge-runtime, Convex functions). Test files in `convex/`
matching `convex/**/*.test.ts`:

```sh
npm run test                   # Runs: vitest run
```

Existing tests: `chat.test.ts`, `files.test.ts`, `limits.test.ts`,
`projects.test.ts`, `tasks.test.ts` (excluded from `convex/tsconfig.json`).

Smoke tests (Bun + Playwright, requires build first):

```sh
npm run build
bun run scripts/test.ts scripts/demo-test.ts
```

Set `IS_PREVIEW=true` to enable test credential login for smoke tests.

### CI Pipeline

`.github/workflows/ci.yml` runs on every push/PR to `main`:
1. **Lint** — `npx biome check .`
2. **Type Check** — `npx tsc -b` AND `npx tsc -p convex/tsconfig.json`
3. **Build** — `npm run build` (best-effort codegen, falls back to committed
   `convex/_generated`)
4. **Test** — `npm run test` (Vitest)
5. **Deploy Convex** — `npx convex deploy` (main branch only, needs
   `CONVEX_DEPLOY_KEY`)

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `VITE_CONVEX_URL` | Convex deployment URL (set by `convex dev`) | Yes |
| `CEREBRAS_API_KEY` | Cerebras free tier (DEFAULT_MODEL provider) | Yes* |
| `GROQ_API_KEY` | Groq free tier (fallback chain) | Yes* |
| `QWENCLOUD_API_KEY` | Qwen Cloud paid tier | Yes* |
| `COHERE_API_KEY` | Cohere production (dons_pick profile) | Recommended |
| `MISTRAL_API_KEY` | Mistral free tier (Codestral) | Recommended |
| `GITHUB_TOKEN_4` | GitHub Models free tier | Recommended |
| `DEEPSEEK_API_KEY` | DeepSeek (confirmed insufficient balance) | No |
| `XAI_API_KEY` | xAI / Grok models | No |
| `MOONSHOT_API_KEY` | Moonshot / Kimi models | No |
| `OPENAI_API_KEY` | OpenAI models (fallback) | No |
| `ANTHROPIC_API_KEY` | Claude (premium profile) | No |
| `GEMINI_API_KEY` | Google Gemini models | No |
| `OPENROUTER_API_KEY` | OpenRouter free + paid models | No |
| `KILOCODE_API_KEY` | Kilo Code free tier | No |
| `RESEND_API_KEY` | Auth emails (OTP, password reset) | Yes |
| `JWT_PRIVATE_KEY` | Auth JWT signing (RSA 2048) | Yes |
| `RAILWAY_ORCHESTRATOR_SECRET` | Swarm HTTP route auth | Yes |
| `IS_PREVIEW` | Enable test login (dev only, never prod) | No |

\* At least one AI API key is required. Cerebras + Groq are recommended as
they power the free-tier default model and fallback chain.

## Development Conventions

### Convex

- **Always read `convex/_generated/ai/guidelines.md` before writing Convex
  code.** It contains rules that override general Convex knowledge.
- Auth uses `@convex-dev/auth` with `ConvexAuthProvider` in `src/main.tsx`
  (not plain `ConvexProvider`).
- Convex functions must check auth via `ctx.auth.getUserIdentity()`.
- HTTP routes require `RAILWAY_ORCHESTRATOR_SECRET` Bearer token for swarm
  orchestrator endpoints; auth routes are exempt.
- Run `npx convex codegen` before `vite build` in production (automatic during
  `npx convex dev`).
- Crons are defined in `convex/crons.ts`. AI-heavy crons are currently
  disabled to stay within free-tier limits; only the task-queue scheduler
  (30s interval) is active.

### Autonomous Build — Working with the Agent System

When modifying the autonomous build pipeline, keep these invariants:

- **`engine.ts` is canonical.** Do not add features to `buildLoop.ts`
  (deprecated v0). New agent execution goes through `engine.runMission` or
  `engine.executeWorkItem`.
- **Every tool call must pass through Sentry.** Add new tools to the
  `ToolName` union and the `executeTool` switch in `engine.ts`.
- **Destructive tools require Debate approval.** See `debate.requireDebate`.
- **Model changes must update three places:** `MODELS` registry,
  `AGENT_MODELS` (per-role defaults), and the fallback chain in
  `callAIWithFallback`. Verify a model is live before adding it — use the
  provider's `/v1/models` endpoint or a direct completion call.
- **`getModelForRole()` has a three-tier resolution:** user chat-panel pick >
  `MODEL_PROFILES` > `AGENT_MODELS`. Don't break this override chain.
- **Small-context models** (Groq, GitHub Models) have `maxSafeInputTokens`
  set — `callAI()` auto-truncates prompts to fit. Don't remove this.
- **BYOK lifetime users** never fall back to platform keys. The chain is
  filtered to only models their supplied keys can serve.

### TypeScript & React

- Strict mode. Use explicit types for context, props, and event handlers.
- Prefer `interface` for props/exported shapes; `type` for unions/aliases.
- Type-only imports: `import type { Doc, Id } from ...`.
- React 19 function components. Named exports for components and utilities;
  default export only for entry points.
- Use `React.ChangeEvent`, `React.KeyboardEvent`, etc. for handler annotations.
- Move complex state/side effects into hooks; keep components small.
- Heavy pages are lazy-loaded via `React.lazy()` in `src/App.tsx`.

### Imports

Order: external packages → `@/` aliases → relative imports.

```ts
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Convex generated files use relative imports:
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
```

### Styling

- Tailwind v4 configured in `src/index.css`. Use `oklch()` colors.
- shadcn/ui New York style with CSS variables (neutral base color). Prefer
  shadcn components over raw controls.
- Use `cn()` from `@/lib/utils` to merge Tailwind classes.
- Avoid horizontal overflow: `min-w-0`, `overflow-hidden`, `break-words`.
- Use `type="button"` on non-submit buttons.

### Vite

- `vite.config.ts` sets COOP/COEP headers (`credentialless`) for the
  in-browser WebContainer sandbox. Required for live preview.
- Vendor libraries are manually chunked (React, Monaco, Recharts, Framer
  Motion, Convex, Radix).

### Formatting (Biome)

Run `npx biome check --write .` before finishing. Config enforces:
2-space indent, 80-char width, double quotes, semicolons, arrow parens
as-needed, organize imports on save.

### Error Handling

- UI async handlers: `try/catch/finally`, clear loading state, show errors via
  `sonner` toasts or inline messages. Never expose raw server errors.
- Convex functions: return `null` or structured errors.
- HTTP routes: return JSON with correct status codes.
- Never log secrets, tokens, or full request bodies with credentials.

### Security

- Never commit `.env.local`, private keys (`JWT_PRIVATE_KEY`), API keys, or
  tokens.
- Treat GitHub tokens, AI keys, email provider keys, and JWT private keys as
  secrets.

## BYOK (Bring Your Own Key)

Lifetime-plan users supply their own AI provider API keys instead of using
the platform's shared keys. See `BYOK_IMPLEMENTATION.md` for the full design
and `convex/apiKeys.ts` + `convex/lib/byok.ts` for the implementation (key
validation, obfuscated storage, per-provider routing).

## Deployment

- **Railway** (primary): Nixpacks, Node 20. Build: `npx convex codegen` →
  `npx vite build`. Serves `dist/` with `serve` (SPA mode).
- **Vercel**: SPA rewrite to `index.html`. Build: `npm run build`.

## Directory Structure

| Directory | Purpose |
|----------|---------|
| `src/` | Vite SPA: pages, components, hooks, contexts, lib |
| `src/components/ui/` | shadcn/ui primitives (generated; do not hand-edit) |
| `convex/` | Backend: schema, queries, mutations, actions, HTTP routes, auth, crons (~75 modules) |
| `convex/_generated/` | Auto-generated Convex code (do not hand-edit) |
| `convex/lib/` | Shared backend helpers (`byok.ts`) |
| `convex/providers/` | AI provider type definitions (`types.ts`) |
| `scripts/` | Bun + Playwright smoke tests and operational scripts |
| `.kilo/` | Kilo orchestrator metadata (do not delete) |

## Key Documentation Files

| File | Content |
|------|---------|
| `PROJECT_CHAPTERS.md` | Full file-by-file architecture map |
| `BYOK_IMPLEMENTATION.md` | Bring Your Own Key design and implementation |
| `convex/README.md` | Convex function-writing basics |
| `convex/_generated/ai/guidelines.md` | Project-specific Convex conventions (authoritative) |
| `AGENTS.md` | Agent-specific conventions (mirrors this file) |
