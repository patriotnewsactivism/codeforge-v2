# CodeForge V2 — Completion Roadmap

> **Status:** ~90% feature-complete. This plan covers the remaining 10% to reach
> production-ready v1.0. Tasks are ordered by priority — critical fixes first,
> then feature completion, then polish.

---

## Phase 0: Critical Bug Fixes

### P0-1: Fix duplicate state declaration in SettingsPage.tsx

**File:** `src/pages/SettingsPage.tsx:38`
**Problem:** `const [savingToken, setSavingToken] = useState(false);` is declared
twice (lines 37 and 38). TypeScript strict mode prevents this from compiling with
`noUnusedLocals: true`.

**Fix:** Delete line 38.

### P0-2: Fix wrong import path in screenshot.ts

**File:** `scripts/screenshot.ts:1`
**Problem:** `import { runTest } from "./scripts/auth";` should be
`import { runTest } from "./auth";`. The test is invoked from the repo root via
`bun run scripts/test.ts scripts/screenshot.ts`, so the relative path resolves
incorrectly from the scripts/ directory.

**Fix:** Change `"./scripts/auth"` to `"./auth"`.

---

## Phase 1: Feature Completion (What's Marked "Coming Soon")

### F1-1: Vercel Deploy Integration

**Files:** `src/components/ide/DeployPanel.tsx:151-153`, new
`convex/deployVercel.ts`

Currently a stub showing "Vercel integration coming soon". Wire a real Vercel
deploy flow:

- New Convex action `deployVercel.deploy` that:
  - Takes `projectId`, zips project files, uploads to Vercel Deploy Hobby API
    (`POST https://api.vercel.com/v13/deployments`)
  - Requires `VERCEL_TOKEN` env var
  - Returns `deploymentUrl`
- Update `DeployPanel.tsx` to call this action on the "Vercel" option
- Show deployment progress (uploading → building → ready)
- Track deployments in the `deployments` table

**Depends on:** `VERCEL_TOKEN` env var being configured.

### F1-2: Real Diff Viewer with Change History

**Files:** `src/components/ide/DiffViewer.tsx`, `convex/changeHistory.ts`

Currently shows a placeholder "current file vs empty original". Wire the real
change history:

- In `DiffViewer.tsx`: fetch change history entries for the selected file from
  `api.changeHistory.listByFile`
- Show before/after comparison using the existing `computeDiff()` logic
- Allow user to browse through historical changes with prev/next navigation
- Add a "Revert" button that restores the `before` content via a mutation

### F1-3: Onboarding Flow for New Users

**New files:** `src/pages/OnboardingPage.tsx`, `src/components/OnboardingWizard.tsx`

After first sign-up, guide the user through:

1. Connect GitHub (optional)
2. Create first project (or import from GitHub)
3. Quick tour of the IDE layout
4. Send first chat message to see AI in action

Route: `/onboarding` → redirect to dashboard on completion. Store
`hasCompletedOnboarding` in user profile.

---

## Phase 2: Testing Infrastructure

### T1: Add Convex Function Tests

**New files:** `convex/*.test.ts`, `vitest.config.ts`

Set up formal testing with Vitest + convex-test + edge-runtime:

```sh
npm install -D vitest convex-test @edge-runtime/vm
```

Cover critical paths:
- `chat.ts` — message sending, model fallback, cost tracking
- `projects.ts` — create, list, delete with auth checks
- `files.ts` — create, read, update, delete with project isolation
- `stripe.ts` — checkout session creation, webhook handling (mock Stripe API)
- `limits.ts` — plan enforcement (free tier gating)
- `agents.ts` — spawn, coordinate, complete tasks

### T2: Add Playwright E2E Test Suite

Extend the existing `scripts/` smoke tests into a proper suite:

- **Auth flow:** sign up → verify email → login → logout
- **Dashboard:** create project → rename → delete
- **IDE critical path:** open project → create file → edit in Monaco → Ctrl+S →
  verify persistence → create folder → delete folder
- **Chat:** send message → verify AI response → switch model → verify fallback
- **Stripe:** open pricing → select plan → mock checkout
- **Git:** connect GitHub → import repo → verify file tree populated

Test files go in `scripts/e2e/`. The existing `scripts/test.ts` runner works as-is.

### T3: CI/CD Pipeline

**New files:** `.github/workflows/ci.yml`

GitHub Actions workflow that runs on PR:

```yaml
jobs:
  lint:       npx biome check .
  typecheck:  npx tsc -b && npx tsc -p convex/tsconfig.json
  build:      npx convex codegen && npm run build
  test:       npm run test  # once vitest is set up
```

---

## Phase 3: Production Hardening

### H1: Error Boundary Coverage

Audit every IDE panel to ensure it is wrapped in `<PanelErrorBoundary>`. One
panel crash should never take down the entire IDE. Current state has
`PanelErrorBoundary` implemented but verify all panels in `IDEPage.tsx` use it.

### H2: Loading & Empty States

Audit every panel for three states: loading, empty, error. Replace any `if (!data) return null` with proper `<PanelSkeleton />` or `<EmptyState />` components.

### H3: Rate Limiting & Abuse Prevention

- Add per-user rate limiting on AI calls (enforce `PLAN_LIMITS` in `limits.ts`)
- Add CAPTCHA or proof-of-work on sign-up
- Add request size validation on HTTP routes (especially `/api/error-ingest`)

### H4: Session & Token Management

- Add token refresh logic to `useAuthToken.ts` if tokens can expire
- Add idle timeout (sign out after 30 min inactivity in authenticated state)
- Clear sensitive state on sign-out

### H5: Security Audit

- Audit every Convex function for proper `getAuthUserId(ctx)` checks
- Verify no Convex function accepts `userId` as an argument for authorization
- Verify all swarm HTTP routes require `RAILWAY_ORCHESTRATOR_SECRET`
- Check that error responses don't leak stack traces or internal state
- Verify Stripe webhook signature validation (raw body parsing)

### H6: Environment Validation on Startup

**New file:** `src/lib/env.ts` or inline in `main.tsx`

On app startup, verify required env vars are present. Show a clear error screen
if `VITE_CONVEX_URL` is missing rather than a cryptic fetch failure.

---

## Phase 4: Polish & UX

### P1: Mobile Responsive Pass

The IDE is desktop-first. Audit key pages for mobile breakpoints:

- `DashboardPage.tsx` — project cards should stack on mobile
- `LandingPage.tsx` — hero and feature cards should reflow
- `PricingPage.tsx` — plan cards should stack
- `SettingsPage.tsx` — tabs should collapse to dropdown

### P2: Accessibility

- Add `aria-label` to icon-only buttons
- Ensure keyboard navigation works in FileTree, ChatPanel, AgentPanel
- Add focus indicators (currently may be overridden by the dark theme)
- Ensure color contrast meets WCAG AA in the dark theme

### P3: Performance

- Add React.lazy + Suspense for heavy panels (AnalyticsDashboard, CinemaPanel,
  ErrorIngestionPanel)
- Memoize expensive Convex query results with `useMemo`
- Debounce file save operations in CodeEditor (instead of saving on every
  keystroke)

### P4: Clean Up Legacy Frontend

**Directory:** `frontend/`

If `frontend/` is confirmed unused, delete it and remove from:
- `.gitignore` (if referenced)
- `AGENTS.md` reference
- Any workspace config

---

## Phase 5: Documentation & Ops

### D1: API Documentation for Swarm Routes

Document all `/api/swarm/*` and `/api/memory/*` routes in a new
`docs/swarm-api.md` for the Railway orchestrator integration.

### D2: Setup Script

**New file:** `scripts/setup.sh` (or `.ps1` for Windows)

One-command setup that:
1. Runs `npm ci`
2. Copies `.env.example` to `.env.local` if missing
3. Runs `npx convex dev` to initialize Convex
4. Prints next steps

### D3: Health Check Endpoint

Add `GET /api/health` to `convex/http.ts` that returns `{ ok: true, version }`
without requiring auth, for Railway health checks.

---

## Implementation Order (Recommended)

1. **P0-1, P0-2** — Critical bugs (same session)
2. **T3** — CI/CD setup (catches regressions early)
3. **F1-1, F1-2, F1-3** — Feature completion (removes "coming soon")
4. **T1, T2** — Tests (confidence for remaining work)
5. **H1-H6** — Hardening (production readiness)
6. **P1-P4** — Polish (shippable quality)
7. **D1-D3** — Documentation (done when everything else is)

---

## Total Task Count: ~30 discrete tasks across 5 phases

Each task is independently implementable and verifiable by running:
```sh
npx biome check --write .
npx tsc -b && npx tsc -p convex/tsconfig.json
npm run build
```
