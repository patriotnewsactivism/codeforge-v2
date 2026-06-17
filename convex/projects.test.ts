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

describe("projects", () => {
  test("creates a project with starter files", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "My Project",
      description: "A test project",
    });
    expect(projectId).toBeTruthy();

    const project = await t.run(async ctx => {
      return await ctx.db.get(projectId);
    });
    expect(project).toBeTruthy();
    expect(project!.name).toBe("My Project");
    expect(project!.description).toBe("A test project");
  });

  test("creates starter files on project creation", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "Starter Files Test",
    });

    const files = await asUser.query(api.files.listByProject, { projectId });
    expect(files).toHaveLength(3);

    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(["index.html", "script.js", "style.css"]);
  });

  test("lists projects owned by the user", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.projects.create, { name: "Project A" });
    await asUser.mutation(api.projects.create, { name: "Project B" });

    const projects = await asUser.query(api.projects.list, {});
    expect(projects).toHaveLength(2);

    const names = projects.map(p => p.name).sort();
    expect(names).toEqual(["Project A", "Project B"]);
  });

  test("get project returns null when project does not belong to user", async () => {
    const t = convexTest(schema, modules);
    const { userId: userAId, identity: identityA } = await seedUser(t);

    // Create a project as user A
    const asA = t.withIdentity(identityA);
    const projectId = await asA.mutation(api.projects.create, {
      name: "User A Project",
    });

    // Create user B
    const userIdB = await t.run(async ctx => {
      return await ctx.db.insert("users", {
        name: "User B",
        email: "userb@test.local",
        emailVerificationTime: Date.now(),
      });
    });
    const asB = t.withIdentity({ subject: `${userIdB}|sess` });

    const project = await asB.query(api.projects.get, { projectId });
    expect(project).toBeNull();
  });

  test("get project returns project when user is collaborator", async () => {
    const t = convexTest(schema, modules);
    const { userId: ownerId, identity: ownerIdentity } = await seedUser(t);
    const asOwner = t.withIdentity(ownerIdentity);

    const projectId = await asOwner.mutation(api.projects.create, {
      name: "Collab Project",
    });

    // Create collaborator user
    const collabUserId = await t.run(async ctx => {
      return await ctx.db.insert("users", {
        name: "Collab User",
        email: "collab@test.local",
        emailVerificationTime: Date.now(),
      });
    });

    // Add collaborator
    await t.run(async ctx => {
      await ctx.db.insert("collaborators", {
        projectId,
        userId: collabUserId as Id<"users">,
        userName: "Collab User",
        color: "#ff0000",
        lastSeenAt: Date.now(),
      });
    });

    const asCollab = t.withIdentity({ subject: `${collabUserId}|sess` });
    const project = await asCollab.query(api.projects.get, { projectId });
    expect(project).toBeTruthy();
    expect(project!.name).toBe("Collab Project");
  });

  test("deletes a project and all cascaded data", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "To Delete",
    });

    // Add a chat session with messages
    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Chat",
    });
    await asUser.mutation(api.chat.addMessage, {
      sessionId,
      projectId,
      role: "user",
      content: "hello",
    });

    await asUser.mutation(api.projects.remove, { projectId });

    // Verify project is gone
    const project = await t.run(async ctx => {
      return await ctx.db.get(projectId);
    });
    expect(project).toBeNull();

    // Verify files are gone
    const files = await t.run(async ctx => {
      return await ctx.db
        .query("files")
        .withIndex("by_project", q => q.eq("projectId", projectId))
        .collect();
    });
    expect(files).toHaveLength(0);

    // Verify chat sessions are gone
    const sessions = await t.run(async ctx => {
      return await ctx.db
        .query("chatSessions")
        .withIndex("by_project", q => q.eq("projectId", projectId))
        .collect();
    });
    expect(sessions).toHaveLength(0);
  });

  test("prevents non-owner from deleting a project", async () => {
    const t = convexTest(schema, modules);
    const { identity: ownerIdentity } = await seedUser(t);
    const asOwner = t.withIdentity(ownerIdentity);

    const projectId = await asOwner.mutation(api.projects.create, {
      name: "Owner Project",
    });

    // Non-owner user
    const nonOwnerId = await t.run(async ctx => {
      return await ctx.db.insert("users", {
        name: "Intruder",
        email: "intruder@test.local",
        emailVerificationTime: Date.now(),
      });
    });
    const asIntruder = t.withIdentity({ subject: `${nonOwnerId}|sess` });

    await expect(
      asIntruder.mutation(api.projects.remove, { projectId }),
    ).rejects.toThrow("Not authorized");
  });

  test("returns empty array for unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const projects = await t.query(api.projects.list, {});
    expect(projects).toEqual([]);
  });

  test("throws when creating project without auth", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.projects.create, { name: "Unauth" }),
    ).rejects.toThrow("Not authenticated");
  });

  test("updates lastOpenedAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const { identity } = await seedUser(t);
    const asUser = t.withIdentity(identity);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "Timestamp Test",
    });

    const before = Date.now();
    await asUser.mutation(api.projects.updateLastOpened, { projectId });

    const project = await t.run(async ctx => {
      return await ctx.db.get(projectId);
    });
    expect(project!.lastOpenedAt).toBeGreaterThanOrEqual(before);
  });
});
