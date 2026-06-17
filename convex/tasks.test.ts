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
      email: "tasks@test.local",
    });
  });
  return {
    userId: userId as Id<"users">,
    identity: { subject: `${userId}|sess` },
  };
}

async function seedProject(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return (await t.run(async ctx => {
    return await ctx.db.insert("projects", {
      name: "Test Project",
      ownerId: userId,
      lastOpenedAt: Date.now(),
    });
  })) as Id<"projects">;
}

describe("tasks", () => {
  test("creates and updates an agent task", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const projectId = await seedProject(t, (identity.subject.split("|")[0]) as any);
    const asUser = t.withIdentity(identity);

    const taskId = await t.mutation(api.tasks.createTask, {
      projectId,
      agentId: "ui-agent",
      agentName: "UI Agent",
      agentIcon: "🎨",
      task: "Make it pretty",
    });
    expect(taskId).toBeTruthy();

    await t.mutation(api.tasks.updateTask, {
      taskId,
      status: "running",
    });

    let tasks = await t.query(api.tasks.listTasks, { projectId });
    expect(tasks[0].status).toBe("running");

    await t.mutation(api.tasks.updateTask, {
      taskId,
      status: "done",
      result: "Made it pretty",
      filesChanged: ["style.css"],
    });

    tasks = await t.query(api.tasks.listTasks, { projectId });
    expect(tasks[0].status).toBe("done");
    expect(tasks[0].result).toBe("Made it pretty");
    expect(tasks[0].filesChanged).toContain("style.css");
    expect(tasks[0].finishedAt).toBeGreaterThan(0);
  });
});
