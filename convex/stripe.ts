/**
 * stripe.ts — Convex action that creates Stripe checkout sessions
 * Called from the frontend pricing page and IDE upgrade button
 */
import { v } from "convex/values";
import { action } from "./_generated/server";

const CHECKOUT_FUNCTION_URL = "https://superagent.base44.com/api/functions/createCheckout";

const APP_URL = "https://codeforge-v2-c96b4570.viktor.space";

export const createCheckoutSession = action({
  args: {
    plan: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("lifetime")),
    userId: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.object({ url: v.string(), sessionId: v.string(), plan: v.string() }),
  handler: async (_ctx, args) => {
    const res = await fetch(CHECKOUT_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: args.plan,
        userId: args.userId,
        email: args.email,
        successUrl: `${APP_URL}/dashboard?checkout=success&plan=${args.plan}`,
        cancelUrl: `${APP_URL}/pricing?checkout=cancelled`,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Checkout failed: ${err}`);
    }

    const data = await res.json() as { url: string; sessionId: string; plan: string };
    return data;
  },
});
