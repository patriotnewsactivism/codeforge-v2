/**
 * Shared BYOK (Bring Your Own Key) resolver.
 *
 * Lifetime users supply their own AI provider API keys. All other plans use
 * platform keys from process.env. This helper resolves the caller's plan and
 * returns their stored keys (if applicable) for injection into AI calls.
 *
 * Extracted from 11 duplicate copies across the codebase.
 */
import { api, internal } from "../_generated/api";

export interface ByokContext {
  callerPlan: string;
  userKeys?: Record<string, string>;
}

export async function resolveByok(
  ctx: {
    runQuery: (ref: any, args: any) => Promise<any>;
  },
  userId?: string,
): Promise<ByokContext> {
  try {
    const sub = await ctx.runQuery(api.limits.getMyLimits, {});
    const callerPlan: string = sub?.plan ?? "free";
    if (callerPlan !== "lifetime") return { callerPlan };
    if (!userId) return { callerPlan };

    const userKeys: Record<string, string> = await ctx.runQuery(
      internal.apiKeys.getAllKeysForUser,
      { userId },
    );
    if (!userKeys || Object.keys(userKeys).length === 0) {
      throw new Error(
        "⚠️ Lifetime plan requires your own API key. " +
          "Add one in Settings → API Keys to use AI features.",
      );
    }
    return { callerPlan, userKeys };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("⚠️")) throw err;
    return { callerPlan: "free" };
  }
}
