/**
 * stripe.ts — Convex backend for Stripe checkout + webhook handling
 *
 * Flow:
 *   1. Frontend calls createCheckoutSession → gets a Stripe checkout URL
 *   2. User pays on Stripe → webhook fires → activatePlan updates user record
 *   3. Frontend reads userPlan to show current plan + limits
 */

import { v } from "convex/values";
import { action, mutation, query, httpAction } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const APP_URL = process.env.APP_URL ?? "https://codeforge-v2-c96b4570.viktor.space";

// ─── PLAN DEFINITIONS ────────────────────────────────────────────────────────

export const PLANS = {
  free: {
    name: "Free",
    priceId: null,
    aiRequestsPerDay: 25,
    missionsPerDay: 3,
    maxAgents: 2,
    maxProjects: 3,
    computeCapCents: 0, // no compute budget
  },
  weekly: {
    name: "Weekly Pro",
    priceId: "price_1TT78bDmDTj65rCTbextWLwt",
    aiRequestsPerDay: 200,
    missionsPerDay: 20,
    maxAgents: 5,
    maxProjects: 10,
    computeCapCents: 500, // $5/week
  },
  monthly: {
    name: "Monthly Pro",
    priceId: "price_1TT78cDmDTj65rCTxe6Beytp",
    aiRequestsPerDay: 500,
    missionsPerDay: 50,
    maxAgents: 10,
    maxProjects: 25,
    computeCapCents: 1500, // $15/month
  },
  lifetime: {
    name: "Lifetime Founder",
    priceId: "price_1TT78cDmDTj65rCTaHejTy8Z",
    aiRequestsPerDay: 1000,
    missionsPerDay: 100,
    maxAgents: 20,
    maxProjects: 100,
    computeCapCents: 5000, // $50/30 days
  },
} as const;

export type PlanKey = keyof typeof PLANS;

// ─── SCHEMA HELPERS ──────────────────────────────────────────────────────────

export const getUserPlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const planKey = (sub?.planKey ?? "free") as PlanKey;
    const plan = PLANS[planKey];

    return {
      planKey,
      planName: plan.name,
      limits: plan,
      stripeCustomerId: sub?.stripeCustomerId,
      stripeSubscriptionId: sub?.stripeSubscriptionId,
      currentPeriodEnd: sub?.currentPeriodEnd,
      status: sub?.status ?? "active",
    };
  },
});

export const upsertSubscription = mutation({
  args: {
    userId: v.id("users"),
    planKey: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    status: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        planKey: args.planKey,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId ?? existing.stripeSubscriptionId,
        currentPeriodEnd: args.currentPeriodEnd,
        status: args.status,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        planKey: args.planKey,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        currentPeriodEnd: args.currentPeriodEnd,
        status: args.status,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

// ─── CREATE CHECKOUT SESSION ─────────────────────────────────────────────────

export const createCheckoutSession = action({
  args: {
    planKey: v.union(
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("lifetime")
    ),
    userId: v.id("users"),
    userEmail: v.optional(v.string()),
  },
  returns: v.string(), // checkout URL
  handler: async (ctx, args) => {
    const plan = PLANS[args.planKey];
    if (!plan.priceId) throw new Error("No price for this plan");

    const isRecurring = args.planKey !== "lifetime";

    const sessionBody: Record<string, string> = {
      "payment_method_types[]": "card",
      "line_items[0][price]": plan.priceId,
      "line_items[0][quantity]": "1",
      "mode": isRecurring ? "subscription" : "payment",
      "success_url": `${APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}&plan=${args.planKey}`,
      "cancel_url": `${APP_URL}/pricing`,
      "client_reference_id": args.userId,
      "metadata[userId]": args.userId,
      "metadata[planKey]": args.planKey,
    };

    if (args.userEmail) {
      sessionBody["customer_email"] = args.userEmail;
    }

    const formBody = Object.entries(sessionBody)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe error: ${err}`);
    }

    const session = await res.json() as { url: string; id: string };
    return session.url;
  },
});

// ─── STRIPE WEBHOOK ──────────────────────────────────────────────────────────

export const stripeWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature") ?? "";

  // Verify webhook signature
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = await verifyStripeWebhook(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const obj = event.data.object as Record<string, unknown>;

  switch (event.type) {
    // One-time payment completed (lifetime)
    case "checkout.session.completed": {
      const userId = (obj.metadata as Record<string, string>)?.userId;
      const planKey = (obj.metadata as Record<string, string>)?.planKey ?? "monthly";
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string | undefined;

      if (userId) {
        await ctx.runMutation(api.stripe.upsertSubscription, {
          userId: userId as any,
          planKey,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          status: "active",
        });
      }
      break;
    }

    // Subscription renewed
    case "invoice.payment_succeeded": {
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      const periodEnd = (obj as any).lines?.data?.[0]?.period?.end;

      // Find subscription by stripeCustomerId
      const sub = await ctx.runQuery(api.stripe.getSubByCustomerId, { customerId });
      if (sub) {
        await ctx.runMutation(api.stripe.upsertSubscription, {
          userId: sub.userId,
          planKey: sub.planKey,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          currentPeriodEnd: periodEnd ? periodEnd * 1000 : undefined,
          status: "active",
        });
      }
      break;
    }

    // Subscription cancelled or payment failed
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const customerId = (obj.customer ?? (obj as any).customer) as string;
      const sub = await ctx.runQuery(api.stripe.getSubByCustomerId, { customerId });
      if (sub) {
        await ctx.runMutation(api.stripe.upsertSubscription, {
          userId: sub.userId,
          planKey: "free",
          stripeCustomerId: customerId,
          status: event.type === "customer.subscription.deleted" ? "cancelled" : "past_due",
        });
      }
      break;
    }
  }

  return new Response("OK", { status: 200 });
});

export const getSubByCustomerId = query({
  args: { customerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.customerId))
      .first();
  },
});

// ─── WEBHOOK SIGNATURE VERIFICATION ──────────────────────────────────────────

async function verifyStripeWebhook(
  body: string,
  signature: string,
  secret: string
): Promise<{ type: string; data: { object: Record<string, unknown> } }> {
  // Parse stripe-signature header: t=timestamp,v1=hash
  const parts = Object.fromEntries(
    signature.split(",").map((p) => p.split("=") as [string, string])
  );
  const timestamp = parts["t"];
  const expectedSig = parts["v1"];

  if (!timestamp || !expectedSig) throw new Error("Missing signature parts");

  // Reconstruct signed payload
  const signedPayload = `${timestamp}.${body}`;

  // HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed !== expectedSig) throw new Error("Signature mismatch");

  // Check timestamp is within 5 minutes
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) throw new Error("Timestamp too old");

  return JSON.parse(body);
}
