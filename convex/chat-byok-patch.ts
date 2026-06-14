/**
 * chat-byok-patch.ts — Patch for convex/chat.ts
 *
 * Shows exactly what to change in your existing sendMessage (or equivalent)
 * action/mutation to thread callerPlan + userKeys through to the AI router.
 *
 * Search for the function in convex/chat.ts that calls callAI or callAIWithFallback
 * and apply these changes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: At the top of convex/chat.ts, add this import
// ─────────────────────────────────────────────────────────────────────────────

import { api } from "./_generated/api";
// (already imported in most cases)

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: In your sendMessage action handler, before calling callAIWithFallback,
//         resolve the caller's plan and their API keys.
//
// Replace your existing AI call block with this pattern:
// ─────────────────────────────────────────────────────────────────────────────

async function resolveCallerContext(ctx: any, userId: any) {
  // Get the user's subscription plan
  const sub = await ctx.runQuery(
    // @ts-ignore
    api.limits.getMyLimits
  );
  const callerPlan: string = sub?.plan ?? "free";

  // For lifetime users, fetch their stored API keys
  let userKeys: Record<string, string> | undefined;
  if (callerPlan === "lifetime") {
    userKeys = await ctx.runQuery(api.apiKeys.getAllKeysForUser, {
      userId,
    });

    // Gate: if lifetime user has no keys at all, block early with clear message
    if (!userKeys || Object.keys(userKeys).length === 0) {
      throw new Error(
        "Lifetime plan requires your own API key. " +
          "Add one in Settings → API Keys to use AI features."
      );
    }
  }

  return { callerPlan, userKeys };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Pass callerPlan and userKeys into callAIWithFallback
//
// BEFORE (original):
//   const { text, modelUsed } = await callAIWithFallback(messages, { model });
//
// AFTER:
//   const { callerPlan, userKeys } = await resolveCallerContext(ctx, userId);
//   const { text, modelUsed } = await callAIWithFallback(messages, {
//     model,
//     callerPlan,
//     userKeys,
//   });
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: In the catch block, detect BYOK errors and surface them clearly.
//
// catch (err) {
//   const message = err instanceof Error ? err.message : "AI request failed";
//   const isByokError =
//     message.includes("API key") || message.includes("Lifetime plan");
//   
//   // Store error message in the chat as an assistant error message
//   await ctx.runMutation(api.chat.insertErrorMessage, {
//     sessionId,
//     projectId,
//     content: isByokError
//       ? `⚠️ ${message}`
//       : `AI error: ${message}`,
//     isError: true,
//   });
// }
// ─────────────────────────────────────────────────────────────────────────────

export {};
