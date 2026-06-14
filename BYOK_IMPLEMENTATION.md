# CodeForge v2 — BYOK Implementation Guide
## Complete step-by-step to ship the Lifetime BYOK feature

---

## Overview
Lifetime users must supply their own AI provider API keys (BYOK).
Weekly/Monthly users continue using the platform's shared API keys.

---

## Step 1: Add `userApiKeys` to `convex/schema.ts`

Open `convex/schema.ts` and paste this table inside `defineSchema({})`,
after the `subscriptions` table:

```typescript
userApiKeys: defineTable({
  userId: v.id("users"),
  provider: v.union(
    v.literal("openai"),
    v.literal("deepseek"),
    v.literal("xai"),
    v.literal("moonshot")
  ),
  encryptedKey: v.string(),
  maskedKey: v.string(),
  isValid: v.optional(v.boolean()),
  validatedAt: v.optional(v.number()),
  addedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_and_provider", ["userId", "provider"]),
```

---

## Step 2: Create `convex/apiKeys.ts`

Copy the file from `codeforge-byok/convex/apiKeys.ts` into your repo as `convex/apiKeys.ts`.

This file provides:
- `listMyKeys` — masked key list for Settings UI
- `getAllKeysForUser` — decrypted keys for AI router (internal)
- `hasAnyKey` — boolean for banner/gate checks
- `saveKey` (action) — validates key with provider, then stores obfuscated
- `deleteKey` — removes a provider key

---

## Step 3: Update `convex/ai.ts`

Replace `convex/ai.ts` with `codeforge-byok/convex/ai-updated.ts`.

Key changes:
- `getApiKey()` accepts `callerPlan` + `userKeys` — routes to user key or platform key
- `callAI()` accepts `callerPlan` + `userKeys` in options
- `callAIWithFallback()` — for lifetime users, fallback chain uses only THEIR available keys;
  does NOT fall back to platform keys if a user's key fails
- New `checkByokRequirement()` helper exported for pre-call gates
- All original model registry, AGENT_MODELS, etc. preserved identically

---

## Step 4: Update `convex/chat.ts` (and any other file calling `callAIWithFallback`)

See `codeforge-byok/convex/chat-byok-patch.ts` for the exact changes.

**Find every call to `callAI` or `callAIWithFallback` in your Convex actions and:**

1. Before the call, resolve caller context:
```typescript
const sub = await ctx.runQuery(api.limits.getMyLimits);
const callerPlan = sub?.plan ?? "free";

let userKeys: Record<string, string> | undefined;
if (callerPlan === "lifetime") {
  const userId = await getAuthUserId(ctx);
  userKeys = await ctx.runQuery(api.apiKeys.getAllKeysForUser, { userId });
  if (!userKeys || Object.keys(userKeys).length === 0) {
    throw new Error(
      "Lifetime plan requires your own API key. Add one in Settings → API Keys."
    );
  }
}
```

2. Pass them into the call:
```typescript
const { text, modelUsed } = await callAIWithFallback(messages, {
  model,
  callerPlan,
  userKeys,
});
```

**Files to check:** `convex/chat.ts`, `convex/engine.ts`, `convex/agents.ts`,
`convex/buildLoop.ts`, `convex/swarm.ts`, `convex/intelligence.ts` —
anywhere `callAI` or `callAIWithFallback` is called.

---

## Step 5: Create `src/components/ide/BYOKBanner.tsx`

Copy from `codeforge-byok/src/components/ide/BYOKBanner.tsx`.

Then add it to `src/pages/DashboardPage.tsx` at the very top of the returned JSX:

```tsx
import { BYOKBanner } from "@/components/ide/BYOKBanner";

// In DashboardPage render, wrap everything:
return (
  <div>
    <BYOKBanner />
    {/* ... rest of dashboard ... */}
  </div>
);
```

The banner auto-hides when:
- User is not on lifetime plan
- User already has a key saved

---

## Step 6: Create `src/components/settings/ApiKeysTab.tsx`

Copy from `codeforge-byok/src/components/settings/ApiKeysTab.tsx`.

Professional secrets-manager UI with:
- Per-provider rows (OpenAI, DeepSeek, xAI, Moonshot)
- Monospace key input, masked display (last 4 chars)
- Color-coded per-provider status badges
- Live validation on save with loading state
- Confirm-before-delete flow
- Shows a "no keys needed" message for non-lifetime users

---

## Step 7: Update `src/pages/SettingsPage.tsx`

Replace with `codeforge-byok/src/pages/SettingsPage-updated.tsx`.

Changes:
- Added tab navigation (Account / Appearance / GitHub / API Keys)
- Tab state synced to `?tab=api-keys` URL param (so BYOKBanner CTA links directly)
- Fixed the duplicate `savingToken` state declaration from the original
- ApiKeysTab rendered when `activeTab === "api-keys"`

---

## Step 8: Update Pricing + Landing copy

See `codeforge-byok/pricing-copy-updates.md` for exact JSX snippets to:
- Lifetime card: replace "$50 compute included" → BYOK callout box
- Add "BYOK — bring your own key" subheading to lifetime price
- Landing page: add BYOK footnote

---

## Step 9: Deploy

```bash
npx convex deploy
# or
bunx convex deploy
```

The schema migration adds `userApiKeys` automatically.
Existing users are unaffected — they simply won't have any keys yet.

---

## Testing Checklist

- [ ] Lifetime user with no keys → BYOK banner visible on dashboard
- [ ] Lifetime user with no keys → AI call returns clear error with settings link
- [ ] Settings → API Keys tab opens directly from banner CTA
- [ ] Add an OpenAI key → validation call fires → "Configured ✓" status shows
- [ ] Invalid key → error shown inline, not saved
- [ ] Banner dismisses after key is saved (hasAnyKey returns true)
- [ ] Lifetime user with key → AI call uses their key, not process.env
- [ ] Lifetime user removes all keys → AI blocked again
- [ ] Weekly/Monthly user → API Keys tab shows "no BYOK needed" message
- [ ] Weekly/Monthly user → AI calls use platform keys (no userKeys passed)
- [ ] Pricing page → lifetime card shows BYOK language, no "$50 compute" claim

---

## Security Notes

- Keys are XOR-obfuscated with a rotation key before storage (not plaintext in Convex DB)
- The `getAllKeysForUser` query should only be called from server-side Convex actions
- Only the last 4 chars of a key are ever returned to the frontend
- For production hardening: replace XOR obfuscation with AES-256-GCM via a KMS-backed
  Convex action (e.g., using the Convex Secrets component or AWS KMS)
