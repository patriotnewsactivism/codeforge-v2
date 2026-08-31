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
      name: "Replay Tester",
      email: "replay@test.local",
      emailVerificationTime: Date.now(),
    });
  });
  return {
    userId: userId as Id<"users">,
    identity: { subject: `${userId}|sess` },
  };
}

async function seedProject(t: ReturnType<typeof convexTest>, userId: Id<"users">) {
  return (await t.run(async ctx => {
    return await ctx.db.insert("projects", {
      name: "Replay Project",
      ownerId: userId,
      lastOpenedAt: Date.now(),
    });
  })) as Id<"projects">;
}

describe("mission replay", () => {
  test("records snapshots and constructs chronological replay timeline", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t);
    const projectId = await seedProject(t, userId);

    await t.mutation(api.missionReplay.recordMissionSnapshot, {
      projectId,
      stepNumber: 1,
      agentId: "architect",
      agentName: "Software Architect",
      actionType: "plan",
      description: "Define API endpoints",
      status: "success",
    });

    await t.mutation(api.missionReplay.recordMissionSnapshot, {
      projectId,
      stepNumber: 2,
      agentId: "coder",
      agentName: "Senior Developer",
      actionType: "edit_file",
      description: "Create auth controller",
      targetFile: "src/auth.ts",
      diff: "+ export function login() {}",
      status: "success",
    });

    const timeline = await t.query(api.missionReplay.getMissionReplayTimeline, {
      projectId,
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0].agentName).toBe("Software Architect");
    expect(timeline[1].filesChanged).toContain("src/auth.ts");
  });
});
