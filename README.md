# CodeForge V2

AI-powered coding platform with multi-model chat, live in-browser preview, multi-agent build mode, and real-time collaboration.

- **Stack:** React + TypeScript + Vite + Convex + Tailwind CSS + Monaco Editor + shadcn/ui
- **Backend:** [Convex](https://convex.dev) — real-time database, auth, and serverless functions. See `convex/README.md` for the Convex function-writing basics, and `convex/_generated/ai/guidelines.md` for project-specific Convex conventions.
- **Live:** [code.donmatthews.live](https://code.donmatthews.live) (also aliased at codeforge-v2.vercel.app)
- **Architecture reference:** see `PROJECT_CHAPTERS.md` for a full file-by-file map of every subsystem (auth, projects, file system/editor, AI chat, multi-agent build loop, deployment, billing, etc.)

## Development

```bash
npm install
npx convex dev   # starts the Convex backend, generates convex/_generated
npm run dev      # starts the Vite dev server
```

Requires `VITE_CONVEX_URL` to be set (via `npx convex dev` or `.env.local`) — there is no offline/local-storage fallback mode; Convex is a hard dependency in every environment.

## Testing & CI

`.github/workflows/ci.yml` runs lint (Biome), typecheck (`tsc -b` at root **and** `tsc -p convex/tsconfig.json` — the root tsconfig does not include `convex/`, so both must be checked separately), build, and tests (Vitest) on every push/PR to `main`, then deploys to Convex production on `main`.

## BYOK (Bring Your Own Key)

Lifetime-plan users supply their own AI provider API keys instead of using the platform's shared keys. See `BYOK_IMPLEMENTATION.md` for the full design, and `convex/apiKeys.ts` for the implementation (key validation, obfuscated storage, per-provider routing).
