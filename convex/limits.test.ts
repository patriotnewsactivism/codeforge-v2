/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedUser(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async ctx => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test@test.local",
      emailVerificationTime: Date.now(),
    });
  });
  return {
    userId: userId as Id<"users">,
    identity: { subject: `${userId}|sess` },
  };
}

describe("limits", () => {
  test("free plan has expected limits", async () => {
    const t = convexTest(schema, modules);

    // Use t.run to directly access the PLAN_LIMITS constant
    const limits = await t.run(async () => {
      const { PLAN_LIMITS } = await import("./limits");
      return PLAN_LIMITS.free;
    });

    expect(limits.aiRequestsPerDay).toBe(15);
    expect(limits.missionsPerDay).toBe(2);
    expect(limits.maxConcurrentAgents).toBe(1);
    expect(limits.maxSpawnDepth).toBe(1);
    expect(limits.maxSpawnsPerMission).toBe(3);
    expect(limits.maxProjects).toBe(2);
    expect(limits.hardCapUsdMonthly).toBe(0.25);
    expect(limits.features.length).toBeGreaterThan(0);
  });

  test("weekly plan has higher limits than free", async () => {
    const t = convexTest(schema, modules);

    const limits = await t.run(async () => {
      const { PLAN_LIMITS } = await import("./limits");
      return PLAN_LIMITS.weekly;
    });

    expect(limits.aiRequestsPerDay).toBeGreaterThan(15);
    expect(limits.missionsPerDay).toBeGreaterThan(2);
    expect(limits.maxSpawnDepth).toBeGreaterThan(1);
  });

  test("monthly plan has even higher limits", async () => {
    const t = convexTest(schema, modules);

    const limits = await t.run(async () => {
      const { PLAN_LIMITS } = await import("./limits");
      return PLAN_LIMITS.monthly;
    });

    expect(limits.maxConcurrentAgents).toBe(12);
    expect(limits.maxSpawnDepth).toBe(4);
    expect(limits.features.length).toBeGreaterThan(7);
  });

  test("lifetime plan has highest limits", async () => {
    const t = convexTest(schema, modules);

    const limits = await t.run(async () => {
      const { PLAN_LIMITS } = await import("./limits");
      return PLAN_LIMITS.lifetime;
    });

    expect(limits.aiRequestsPerDay).toBe(1500);
    expect(limits.maxConcurrentAgents).toBe(32);
    expect(limits.maxSpawnDepth).toBe(5);
    expect(limits.hardCapUsdMonthly).toBe(50);
  });

  test("checkCanRun returns not allowed when not authenticated", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Not authenticated");
  });

  test("checkCanRun allows ai_request for free tier user with no usage", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);

    // Create a free-tier subscription record
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        userId,
        planKey: "free",
        status: "active",
        updatedAt: Date.now(),
      });
    });

    const asUser = t.withIdentity(identity);

    const result = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(result.allowed).toBe(true);
  });

  test("checkCanRun blocks ai_request when daily limit reached", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);

    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        userId,
        planKey: "free",
        status: "active",
        updatedAt: Date.now(),
      });

      // Insert usage record with max requests already used
      const today = new Date().toISOString().slice(0, 10);
      await ctx.db.insert("userUsage", {
        userId: String(userId),
        date: today,
        aiRequests: 15, // Free tier limit is 15
        missions: 0,
        agentsSpawned: 0,
        computeCostUsd: 0,
        periodStart: Date.now(),
      });
    });

    const asUser = t.withIdentity(identity);

    const result = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily AI request limit reached");
    expect(result.reason).toContain("15");
  });

  test("checkCanRun blocks start_mission when daily limit reached", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);

    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        userId,
        planKey: "free",
        status: "active",
        updatedAt: Date.now(),
      });

      const today = new Date().toISOString().slice(0, 10);
      await ctx.db.insert("userUsage", {
        userId: String(userId),
        date: today,
        aiRequests: 0,
        missions: 2, // Free tier limit is 2
        agentsSpawned: 0,
        computeCostUsd: 0,
        periodStart: Date.now(),
      });
    });

    const asUser = t.withIdentity(identity);

    const result = await asUser.query(api.limits.checkCanRun, {
      action: "start_mission",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily mission limit reached");
  });

  test("checkCanRun blocks when monthly spend cap is reached", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);

    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        userId,
        planKey: "free",
        status: "active",
        updatedAt: Date.now(),
      });

      // Insert spend record at cap
      const monthKey = new Date().toISOString().slice(0, 7);
      await ctx.db.insert("userSpend", {
        userId: String(userId),
        periodKey: monthKey,
        totalCostUsd: 0.25,
        capUsd: 0.25,
        plan: "free",
      });
    });

    const asUser = t.withIdentity(identity);

    const result = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly compute cap");
  });

  test("getMyLimits returns free defaults when not authenticated", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.limits.getMyLimits, {});
    expect(result.plan).toBe("free");
    expect(result.limits.aiRequestsPerDay).toBe(15);
    expect(result.usage).toBeNull();
    expect(result.spend).toBeNull();
  });

  test("getMyLimits returns plan and usage for authenticated user", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);

    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        userId,
        planKey: "monthly",
        status: "active",
        updatedAt: Date.now(),
      });

      const today = new Date().toISOString().slice(0, 10);
      await ctx.db.insert("userUsage", {
        userId: String(userId),
        date: today,
        aiRequests: 5,
        missions: 1,
        agentsSpawned: 0,
        computeCostUsd: 0.02,
        periodStart: Date.now(),
      });
    });

    const asUser = t.withIdentity(identity);

    const result = await asUser.query(api.limits.getMyLimits, {});
    expect(result.plan).toBe("monthly");
    expect(result.limits.maxSpawnDepth).toBe(4);
    expect(result.usage).toBeTruthy();
    expect(result.usage!.aiRequests).toBe(5);
  });

  test("trackUsage increments ai_request counter", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t);

    await t.mutation(api.limits.trackUsage, {
      userId: String(userId),
      action: "ai_request",
    });

    const today = new Date().toISOString().slice(0, 10);
    const usage = await t.run(async ctx => {
      return await ctx.db
        .query("userUsage")
        .withIndex("by_user_date", q =>
          q.eq("userId", String(userId)).eq("date", today),
        )
        .first();
    });
    expect(usage).toBeTruthy();
    expect(usage!.aiRequests).toBe(1);
    expect(usage!.missions).toBe(0);
  });

  test("trackUsage increments mission counter", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t);

    await t.mutation(api.limits.trackUsage, {
      userId: String(userId),
      action: "start_mission",
    });

    const today = new Date().toISOString().slice(0, 10);
    const usage = await t.run(async ctx => {
      return await ctx.db
        .query("userUsage")
        .withIndex("by_user_date", q =>
          q.eq("userId", String(userId)).eq("date", today),
        )
        .first();
    });
    expect(usage).toBeTruthy();
    expect(usage!.missions).toBe(1);
    expect(usage!.aiRequests).toBe(0);
  });

  test("trackUsage spawn_agent increments agent counter", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t);

    await t.mutation(api.limits.trackUsage, {
      userId: String(userId),
      action: "spawn_agent",
    });

    const today = new Date().toISOString().slice(0, 10);
    const usage = await t.run(async ctx => {
      return await ctx.db
        .query("userUsage")
        .withIndex("by_user_date", q =>
          q.eq("userId", String(userId)).eq("date", today),
        )
        .first();
    });
    expect(usage!.agentsSpawned).toBe(1);
  });

  test("trackUsage accumulates cost in spend record", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t);

    await t.mutation(api.limits.trackUsage, {
      userId: String(userId),
      action: "ai_request",
      costUsd: 0.05,
    });

    const monthKey = new Date().toISOString().slice(0, 7);
    const spend = await t.run(async ctx => {
      return await ctx.db
        .query("userSpend")
        .withIndex("by_user_period", q =>
          q.eq("userId", String(userId)).eq("periodKey", monthKey),
        )
        .first();
    });
    expect(spend).toBeTruthy();
    expect(spend!.totalCostUsd).toBe(0.05);
    expect(spend!.capUsd).toBe(0.25); // Free tier cap
  });

  test("getUserSpend returns null for nonexistent record", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.limits.getSpend, {
      userId: "none",
      periodKey: "2000-01",
    });
    expect(result).toBeNull();
  });

  test.skip("getUserPlanLimits action (requires subscriptions setup)", async () => {});
});
