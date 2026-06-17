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

describe("files", () => {
  test("creates a file in a project", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "src/app.ts",
      name: "app.ts",
      content: "console.log('hello');",
      isDirectory: false,
      language: "typescript",
    });

    expect(fileId).toBeTruthy();

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file).toBeTruthy();
    expect(file!.path).toBe("src/app.ts");
    expect(file!.name).toBe("app.ts");
    expect(file!.content).toBe("console.log('hello');");
    expect(file!.language).toBe("typescript");
    expect(file!.isDirectory).toBe(false);
  });

  test("creates a directory", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const dirId = await asUser.mutation(api.files.create, {
      projectId,
      path: "src/components",
      name: "components",
      isDirectory: true,
    });

    const dir = await t.run(async ctx => {
      return await ctx.db.get(dirId);
    });
    expect(dir).toBeTruthy();
    expect(dir!.isDirectory).toBe(true);
  });

  test("auto-detects language from file extension", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "src/utils.py",
      name: "utils.py",
      isDirectory: false,
    });

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file!.language).toBe("python");
  });

  test("prevents duplicate file paths in same project", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.files.create, {
      projectId,
      path: "README.md",
      name: "README.md",
      isDirectory: false,
    });

    await expect(
      asUser.mutation(api.files.create, {
        projectId,
        path: "README.md",
        name: "README.md",
        isDirectory: false,
      }),
    ).rejects.toThrow("File already exists at this path");
  });

  test("lists files by project", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.files.create, {
      projectId,
      path: "file1.ts",
      name: "file1.ts",
      isDirectory: false,
    });
    await asUser.mutation(api.files.create, {
      projectId,
      path: "file2.ts",
      name: "file2.ts",
      isDirectory: false,
    });

    const files = await asUser.query(api.files.listByProject, { projectId });
    expect(files).toHaveLength(2);

    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(["file1.ts", "file2.ts"]);
  });

  test("gets file by project and path", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.files.create, {
      projectId,
      path: "src/main.ts",
      name: "main.ts",
      content: "// main",
      isDirectory: false,
    });

    const file = await asUser.query(api.files.getByPath, {
      projectId,
      path: "src/main.ts",
    });
    expect(file).toBeTruthy();
    expect(file!.name).toBe("main.ts");
    expect(file!.content).toBe("// main");
  });

  test("getByPath returns null for nonexistent file", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const file = await asUser.query(api.files.getByPath, {
      projectId,
      path: "nonexistent.ts",
    });
    expect(file).toBeNull();
  });

  test("updates file content via updateContent", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "notes.txt",
      name: "notes.txt",
      content: "draft",
      isDirectory: false,
    });

    await asUser.mutation(api.files.updateContent, {
      fileId,
      content: "final version",
    });

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file!.content).toBe("final version");
  });

  test("updates file content and language via update", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "code.js",
      name: "code.js",
      content: "var x = 1;",
      isDirectory: false,
    });

    await asUser.mutation(api.files.update, {
      fileId,
      content: "const x: number = 1;",
      language: "typescript",
    });

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file!.content).toBe("const x: number = 1;");
    expect(file!.language).toBe("typescript");
  });

  test("renames a file", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "old.ts",
      name: "old.ts",
      isDirectory: false,
    });

    await asUser.mutation(api.files.rename, {
      fileId,
      newName: "new.ts",
      newPath: "new.ts",
    });

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file!.name).toBe("new.ts");
    expect(file!.path).toBe("new.ts");
  });

  test("deletes a file", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const fileId = await asUser.mutation(api.files.create, {
      projectId,
      path: "temp.txt",
      name: "temp.txt",
      isDirectory: false,
    });

    await asUser.mutation(api.files.remove, { fileId });

    const file = await t.run(async ctx => {
      return await ctx.db.get(fileId);
    });
    expect(file).toBeNull();
  });

  test("bulk inserts files", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    const result = await asUser.mutation(api.files.bulkInsert, {
      projectId,
      files: [
        { path: "a.ts", name: "a.ts", type: "file" as const, content: "a" },
        { path: "b.ts", name: "b.ts", type: "file" as const, content: "b" },
        { path: "lib", name: "lib", type: "folder" as const },
      ],
    });

    expect(result.inserted).toBe(3);

    const files = await asUser.query(api.files.listByProject, { projectId });
    expect(files).toHaveLength(3);
  });

  test("bulk insert overwrites existing file at same path", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.files.create, {
      projectId,
      path: "config.json",
      name: "config.json",
      content: '{"v": 1}',
      isDirectory: false,
    });

    await asUser.mutation(api.files.bulkInsert, {
      projectId,
      files: [
        {
          path: "config.json",
          name: "config.json",
          type: "file" as const,
          content: '{"v": 2}',
        },
      ],
    });

    const file = await asUser.query(api.files.getByPath, {
      projectId,
      path: "config.json",
    });
    expect(file!.content).toBe('{"v": 2}');
  });

  test("throws when creating file without auth", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.files.create, {
        projectId: "none" as Id<"projects">,
        path: "test.ts",
        name: "test.ts",
        isDirectory: false,
      }),
    ).rejects.toThrow("Not authenticated");
  });
});
