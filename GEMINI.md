# GEMINI.md - CodeForge V2 Instructions

This file provides architectural context, development standards, and operational guidelines for Gemini CLI interactions within the CodeForge V2 project.

---

## 🏗 Project Overview
**CodeForge V2** is an AI-powered software engineering platform designed for autonomous development. It combines a high-performance web-based IDE with a sophisticated multi-agent backend to automate the full software lifecycle.

### Core Tech Stack
- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui (New York style).
- **Backend:** [Convex](https://convex.dev) (v1.41) - Real-time database, cloud functions, and file storage.
- **IDE:** Monaco Editor integration with custom AI-assisted features.
- **AI Orchestration:** Multi-agent "Swarm" system with persistent memory, self-correction (forensics/mutations), and debate mechanisms.
- **Auth:** `@convex-dev/auth` with email OTP (via Resend) and GitHub OAuth.

---

## 🚀 Key Commands

### Development
- `npm run dev`: Starts the Vite development server with HMR.
- `npx convex dev`: Starts the Convex development environment (real-time codegen and backend logs).
- `npx convex logs`: Tails the live backend logs.

### Build & Verification
- `npm run build`: Generates the production build in `/dist`.
- `npx tsc -b`: Runs TypeScript type-checking for the frontend and node configs.
- `npx tsc -p convex/tsconfig.json`: Runs type-checking for Convex backend functions.
- `npx biome check .`: Runs linting and formatting checks (Biome).
- `npx biome check --write .`: Automatically fixes linting and formatting issues.

### Testing
- `npm run build && bun run scripts/test.ts scripts/demo-test.ts`: Runs smoke tests using Bun and Playwright.
- **Note:** Smoke tests require `IS_PREVIEW=true` in the environment to bypass production auth constraints.

---

## 📐 Architecture & Conventions

### Directory Map
- `src/`: Main React application (Pages, Components, Hooks, Contexts).
- `convex/`: Backend logic (Schema, Mutations, Queries, Actions, HTTP routes).
- `convex/_generated/`: Auto-generated Convex files (**DO NOT EDIT MANUALLY**).
- `.kilo/`: Metadata and configurations for the Kilo agent orchestrator.
- `scripts/`: Operational scripts and smoke tests (run with Bun).
- `public/`: Static assets.

### Convex Development
- **Guidelines:** Always consult `convex/_generated/ai/guidelines.md` for backend-specific coding rules.
- **Auth:** Use `ctx.auth.getUserIdentity()` to verify users in backend functions.
- **HTTP Routes:** Custom endpoints in `convex/http.ts` often require a `RAILWAY_ORCHESTRATOR_SECRET` Bearer token.

### UI & Styling
- **Styling:** Use Tailwind CSS v4 utility classes and `oklch()` color space.
- **Components:** Prefer existing shadcn/ui components located in `src/components/ui`.
- **Merging Classes:** Use the `cn()` utility from `@/lib/utils`.
- **Icons:** Use `lucide-react`.

### Coding Standards
- **TypeScript:** Strict mode enabled. Use type-only imports (`import type { ... }`).
- **Formatting:** Enforced by Biome (2-space indentation, double quotes, semicolons).
- **State Management:** Keep components lean; move complex logic into custom hooks.
- **Error Handling:** Use `try/catch` in async handlers and report errors to users via `sonner` toasts.

---

## 🔐 Security & Environment
- **Secrets:** Never log or commit API keys (`OPENAI_API_KEY`, `RESEND_API_KEY`, etc.) or internal secrets (`RAILWAY_ORCHESTRATOR_SECRET`).
- **Environment:**
    - `VITE_CONVEX_URL`: Backend connection string (auto-set by `npx convex dev`).
    - `IS_PREVIEW`: Set to `true` ONLY in dev/test environments for automation.

---

## 🤖 Agent Specifics
- **Task Logs:** Agents track their progress in `agentTasks`, `agentThoughts`, and `toolCalls` tables.
- **Self-Correction:** The "Forensic" and "Mutation" systems allow the platform to learn from agent failures and improve prompts/strategies automatically.
- **Debate:** Destructive or high-impact architectural changes are mediated by a Proponent/Opponent agent debate system.
