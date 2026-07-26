# QWEN.md

Context file for AI coding agents working in this repository.

## Project Overview

**CodeForge V2** is an AI-powered coding platform with multi-model chat, live
in-browser preview, multi-agent build mode, and real-time collaboration. Users
create projects, edit code in a Monaco-based IDE, chat with AI models
(DeepSeek, xAI/Grok, Moonshot/Kimi, OpenAI), and deploy results — all backed by
Convex for real-time state, auth, and serverless functions.

**Live:** [code.donmatthews.live](https://code.donmatthews.live)

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

### Architecture

- **`src/`** — Vite SPA: pages, components, hooks, contexts, lib utilities.
- **`src/components/ui/`** — shadcn/ui primitives (generated; do not hand-edit).
- **`convex/`** — All backend logic: schema, queries, mutations, actions, HTTP
  routes, auth, crons. ~60 modules covering projects, files, chat, agents,
  build loop, deployment, billing, collaboration, and more.
- **`convex/_generated/`** — Auto-generated Convex code (do not hand-edit).
- **`scripts/`** — Bun + Playwright smoke tests and operational scripts.
- **`.kilo/`** — Kilo orchestrator metadata (do not delete).
- **`PROJECT_CHAPTERS.md`** — Full file-by-file architecture reference.

## Building and Running

```sh
npm ci                 # Install dependencies
npx convex dev         # Start Convex backend + codegen watch (sets VITE_CONVEX_URL)
npm run dev            # Vite dev server with HMR
npm run build          # Production build (requires convex/_generated)
npm run preview        # Preview production build on port 4173
```

### Type Checking

Two separate TypeScript projects must both pass:

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

### Testing

Unit tests (Vitest, edge-runtime, Convex functions):

```sh
npm run test                   # Runs: vitest run (convex/**/*.test.ts)
```

Smoke tests (Bun + Playwright, requires build first):

```sh
npm run build
bun run scripts/test.ts scripts/demo-test.ts
```

Set `IS_PREVIEW=true` in the environment to enable test credential login in the
Convex backend for smoke tests.

### CI Pipeline

`.github/workflows/ci.yml` runs on every push/PR to `main`:
1. **Lint** — `npx biome check .`
2. **Type Check** — `npx tsc -b` AND `npx tsc -p convex/tsconfig.json`
3. **Build** — `npm run build` (uses committed `convex/_generated`)
4. **Test** — `npm run test` (Vitest)
5. **Deploy Convex** — `npx convex deploy` (main branch only, needs deploy key)

## Environment Variables

| Variable                    | Purpose                                    | Required |
| --------------------------- | ------------------------------------------ | -------- |
| `VITE_CONVEX_URL`           | Convex deployment URL (set by `convex dev`)| Yes      |
| `DEEPSEEK_API_KEY`          | DeepSeek AI models                         | One of*  |
| `XAI_API_KEY`               | xAI / Grok models                          | One of*  |
| `MOONSHOT_API_KEY`          | Moonshot / Kimi models                     | One of*  |
| `OPENAI_API_KEY`            | OpenAI models (fallback)                   | One of*  |
| `RESEND_API_KEY`            | Auth emails (OTP, password reset)          | Yes      |
| `JWT_PRIVATE_KEY`           | Auth JWT signing (RSA 2048)                | Yes      |
| `RAILWAY_ORCHESTRATOR_SECRET` | Swarm HTTP route auth                    | Yes      |
| `IS_PREVIEW`                | Enable test login (dev only, never prod)   | No       |

\* At least one AI API key is required.

## Development Conventions

### Convex

- **Always read `convex/_generated/ai/guidelines.md` before writing Convex
  code.** It contains rules that override general Convex knowledge.
- Auth uses `@convex-dev/auth` with `ConvexAuthProvider` in `src/main.tsx`.
- Convex functions must check auth via `ctx.auth.getUserIdentity()`.
- HTTP routes require `RAILWAY_ORCHESTRATOR_SECRET` Bearer token for swarm
  orchestrator endpoints; auth routes are exempt.
- Run `npx convex codegen` before `vite build` in production (automatic during
  `npx convex dev`).

### TypeScript & React

- Strict mode. Use explicit types for context, props, and event handlers.
- Prefer `interface` for props/exported shapes; `type` for unions/aliases.
- Type-only imports: `import type { Doc, Id } from ...`.
- React 19 function components. Named exports for components and utilities;
  default export only for entry points.
- Use `React.ChangeEvent`, `React.KeyboardEvent`, etc. for handler annotations.
- Move complex state/side effects into hooks; keep components small.

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
- shadcn/ui New York style with CSS variables. Prefer shadcn components.
- Use `cn()` from `@/lib/utils` to merge Tailwind classes.
- Avoid horizontal overflow: `min-w-0`, `overflow-hidden`, `break-words`.
- Use `type="button"` on non-submit buttons.

### Formatting (Biome)

- 2-space indent, 80-char line width
- Double quotes, semicolons
- Arrow parens as-needed
- Organize imports on save
- Run `npx biome check --write .` before finishing work.

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

## Deployment

- **Railway** (primary): Nixpacks. Build: `npx convex codegen` → `npx vite build`. Serves `dist/` with `serve`.
- **Vercel**: SPA rewrite to `index.html`. Build: `npm run build`.

## Key Documentation Files

| File                     | Content                                          |
| ------------------------ | ------------------------------------------------ |
| `PROJECT_CHAPTERS.md`    | Full file-by-file architecture map               |
| `BYOK_IMPLEMENTATION.md` | Bring Your Own Key design and implementation     |
| `convex/README.md`       | Convex function-writing basics                   |
| `convex/_generated/ai/guidelines.md` | Project-specific Convex conventions (authoritative) |
| `AGENTS.md`              | Agent-specific conventions (mirrors this file)   |
