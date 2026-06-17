/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedUser(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test@test.local",
      emailVerificationTime: Date.now(),
    });
  });
  return { userId: userId as Id<"users">, identity: { subject: `${userId}|sess` } };
}

async function seedProject(t: ReturnType<typeof convexTest>, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: "Test Project",
      ownerId: userId,
      lastOpenedAt: Date.now(),
    });
  }) as Id<"projects">;
}

describe("chat", () => {
  test("creates a chat session", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Test Chat",
      model: "deepseek-v4",
    });
    expect(sessionId).toBeTruthy();
  });

  test("lists sessions sorted by newest first", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Older",
    });
    await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Newer",
    });

    const sessions = await asUser.query(api.chat.listSessions, { projectId });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe("Newer");
    expect(sessions[1].title).toBe("Older");
  });

  test("only lists active (non-archived) sessions", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Active",
    });
    await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Archived",
    });

    await asUser.mutation(api.chat.archiveSession, { sessionId });

    const sessions = await asUser.query(api.chat.listSessions, { projectId });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Archived");
  });

  test("adds a user message and retrieves it", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
    });

    const msgId = await asUser.mutation(api.chat.addMessage, {
      sessionId,
      projectId,
      role: "user",
      content: "Hello, AI!",
    });
    expect(msgId).toBeTruthy();

    const messages = await asUser.query(api.chat.listMessages, { sessionId });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello, AI!");
    expect(messages[0].role).toBe("user");
  });

  test("adding a message with tokens updates session counters", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
    });

    await asUser.mutation(api.chat.addMessage, {
      sessionId,
      projectId,
      role: "assistant",
      content: "Response",
      tokensUsed: 150,
      cost: 0.002,
    });

    const session = await asUser.query(api.chat.getSession, { sessionId });
    expect(session!.totalTokensUsed).toBe(150);
    expect(session!.totalCost).toBe(0.002);
  });

  test("renames a session", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "Old",
    });

    await asUser.mutation(api.chat.renameSession, {
      sessionId,
      title: "Renamed",
    });

    const session = await asUser.query(api.chat.getSession, { sessionId });
    expect(session!.title).toBe("Renamed");
  });

  test("archives a session so it disappears from list", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      title: "To Archive",
    });

    await asUser.mutation(api.chat.archiveSession, { sessionId });

    const sessions = await asUser.query(api.chat.listSessions, { projectId });
    expect(sessions).toHaveLength(0);
  });

  test("deletes a session and its messages", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
    });
    await asUser.mutation(api.chat.addMessage, {
      sessionId,
      projectId,
      role: "user",
      content: "msg",
    });

    await asUser.mutation(api.chat.deleteSession, { sessionId });

    const messages = await asUser.query(api.chat.listMessages, { sessionId });
    expect(messages).toHaveLength(0);
  });

  test("updates session model", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const sessionId = await asUser.mutation(api.chat.createSession, {
      projectId,
      model: "deepseek-v4",
    });

    await asUser.mutation(api.chat.updateModel, {
      sessionId,
      model: "gpt-4o",
    });

    const session = await asUser.query(api.chat.getSession, { sessionId });
    expect(session!.model).toBe("gpt-4o");
  });

  test("getSession returns null for nonexistent session", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.chat.getSession, {
      sessionId: "nonexistent" as Id<"chatSessions">,
    });
    expect(result).toBeNull();
  });

  test("listModels returns available models", async () => {
    const t = convexTest(schema, modules);
    const models = await t.query(api.chat.listModels, {});
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeTruthy();
    expect(models[0].name).toBeTruthy();
    expect(typeof models[0].tier).toBe("string");
  });

  test("throws when calling auth-gated mutation without identity", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.chat.createSession, {
        projectId: "none" as Id<"projects">,
        title: "Test",
      })
    ).rejects.toThrow("Not authenticated");
  });

  test.skip("sendMessage dispatches to AI (requires external API)", async () => {});
});
