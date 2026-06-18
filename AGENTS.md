# AGENTS.md

This file is for agentic coding agents working in this repository. Read it before
making changes, and update it when project conventions change.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite 7 + Tailwind v4 + shadcn/ui (New
  York style), React Router v7, Monaco Editor for the IDE.
- **Backend:** [Convex](https://convex.dev) (v1.41) — schema, queries, mutations,
  actions, HTTP routes, auth, file storage.
- **`.kilo/`** contains the Kilo orchestrator (worker metadata, templates,
  knowledge base). Do not delete `.kilo/AGENTS.md`,
  `.kilo/knowledgeBase.json`, or `.kilo/templates.json`.

## Convex

Always read `convex/_generated/ai/guidelines.md` before writing Convex code. It
contains rules that override general Convex knowledge. Install reusable Convex
agent skills with `npx convex ai-files install`.

Repo-specific Convex conventions beyond the generated guidelines:

- Auth uses `@convex-dev/auth` with email OTP (Resend). The app sets up
  `ConvexAuthProvider` in `src/main.tsx`, not plain `ConvexProvider`.
- HTTP routes require the `RAILWAY_ORCHESTRATOR_SECRET` Bearer token for the
  swarm orchestrator endpoints. Auth routes are exempt.
- Convex codegen (`npx convex codegen`) must run before `vite build` in
  production (see `nixpacks.toml`). This is automatic during `npx convex dev`.

## Commands

```sh
npm ci
npm run dev          # Vite dev server + HMR
npm run build        # Vite production build
npm run preview      # Preview built app on port 4173
```

Type checking (not exposed as npm scripts):

```sh
npx tsc -b                        # App + Node configs
npx tsc -p convex/tsconfig.json   # Convex functions
```

Formatting and linting (Biome):

```sh
npx biome check .
npx biome check --write .    # Auto-fix
npx biome format . --write
```

Convex operations:

```sh
npx convex dev       # Start Convex dev server + codegen watch
npx convex deploy    # Deploy Convex functions
npx convex logs      # Tail Convex logs
```

## Testing

There is no formal test framework. Smoke tests live in `scripts/` and run with
Bun + Playwright. Build first, then run tests through the preview harness:

```sh
npm run build
bun run scripts/test.ts scripts/demo-test.ts
bun run scripts/test.ts scripts/demo-test.ts scripts/screenshot.ts
```

The test runner starts `npm run preview` (port 4173), waits for readiness, runs
each test file as a Bun script with `APP_URL=http://localhost:4173`, then stops
the server.

`scripts/auth.ts` is a Playwright test helper (browser automation + test user
sign-in). It is unrelated to `convex/auth.ts`. `scripts/testUser.ts` exports
hardcoded test credentials used by Playwright smoke tests. Set `IS_PREVIEW=true`
in the environment to enable test credential login in the Convex backend.

## Project structure

| Directory           | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `src/`              | Vite app entry, pages, components, hooks, lib    |
| `src/App.tsx`       | React Router route definitions                   |
| `src/components/ui/`| shadcn/ui primitives (generated, don't hand-edit)|
| `convex/`           | Convex functions, schema, auth, HTTP routes      |
| `convex/_generated/`| Auto-generated Convex code (don't hand-edit)     |
| `scripts/`          | Smoke tests and operational scripts (Bun)        |
| `.kilo/`            | Kilo orchestrator metadata and worker config     |

## TypeScript and React style

- Strict mode enabled. Use explicit types for context, props, and event handlers.
- Prefer `interface` for props and exported shapes; `type` for unions and
  aliases.
- Use type-only imports: `import type { Doc, Id } from ...`.
- React 19 function components. Named exports for components and utilities;
  default export only for entry points.
- Move complex state and side effects into hooks; keep components small.
- Use `React.ChangeEvent`, `React.KeyboardEvent`, etc. for handler annotations.

## Imports

Order: external packages → `@/` aliases → relative imports. Use shadcn aliases
from `components.json`:

```ts
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
```

Use relative imports for Convex generated files:

```ts
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
```

## Tailwind and UI

- Tailwind v4 configured in `src/index.css`.
- shadcn/ui New York style with CSS variables. Prefer shadcn components over raw
  controls.
- Use `cn()` from `@/lib/utils` to merge Tailwind classes.
- Use `oklch()` colors consistent with the existing theme.
- Avoid horizontal overflow: `min-w-0`, `overflow-hidden`, `break-words`.
- Use `type="button"` on non-submit buttons.

## Formatting

Run `npx biome check --write .` before finishing. Config enforces:
- 2-space indent, 80-char line width
- Double quotes, semicolons
- Arrow parens as-needed
- Organize imports on save

## Error handling

- UI async handlers: `try/catch/finally`, clear loading state, show errors via
  `sonner` toasts or inline messages. Never expose raw server errors.
- Convex functions: check auth via `ctx.auth.getUserIdentity()`, return `null` or
  structured errors.
- HTTP routes: return JSON with correct status codes.
- Never log secrets, tokens, or full request bodies with credentials.

## Environment variables

Required:
- `VITE_CONVEX_URL` — set automatically by `npx convex dev`
- At least one AI API key: `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `MOONSHOT_API_KEY`,
  or `OPENAI_API_KEY`
- `RESEND_API_KEY` — for auth emails (OTP, password reset)
- `RAILWAY_ORCHESTRATOR_SECRET` — for swarm HTTP route auth

Dev-only:
- `IS_PREVIEW=true` — enables test credential login (never in production)

## Deployment

- **Railway** (primary): uses Nixpacks. Build runs `npx convex codegen` then
  `npx vite build`. Serves `dist/` with `serve`.
- **Vercel**: SPA rewrite to `index.html`. Build command is `npm run build`.

## Secrets

Never commit `.env.local`, private keys (including `JWT_PRIVATE_KEY`), API keys,
or tokens. Treat GitHub tokens, AI keys, email provider keys, and JWT private
keys as secrets.
