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
      email: "limits@test.local",
    });
  });
  return {
    userId: userId as Id<"users">,
    identity: { subject: `${userId}|sess` },
  };
}

describe("limits", () => {
  test("free tier allows first AI request", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    const check = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(check.allowed).toBe(true);
  });

  test("blocks AI request when daily limit reached", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    // Hit the limit for free tier (15)
    for (let i = 0; i < 15; i++) {
      await t.mutation(api.limits.trackUsage, {
        userId: String(userId),
        action: "ai_request",
      });
    }

    const check = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Daily AI request limit reached");
  });

  test("blocks start_mission when limit reached", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    // Hit the limit for free tier (2 missions)
    for (let i = 0; i < 2; i++) {
      await t.mutation(api.limits.trackUsage, {
        userId: String(userId),
        action: "start_mission",
      });
    }

    const check = await asUser.query(api.limits.checkCanRun, {
      action: "start_mission",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Daily mission limit reached");
  });

  test("hard cap stops all requests", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    // Track expensive usage hitting the hard cap
    await t.mutation(api.limits.trackUsage, {
      userId: String(userId),
      action: "ai_request",
      costUsd: 10.0, // way over free tier cap of $0.25
    });

    const check = await asUser.query(api.limits.checkCanRun, {
      action: "ai_request",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("compute cap ($0.25) reached");
  });
});
