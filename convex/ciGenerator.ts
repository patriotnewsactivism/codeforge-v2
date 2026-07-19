import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

export const generateSmokeTests = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });
    const codeFiles = files.filter(
      (f: any) =>
        !f.isDirectory && (f.path.endsWith(".tsx") || f.path.endsWith(".ts")),
    );

    let appRoutes = "No routes found.";
    const appTsx = codeFiles.find(
      (f: any) =>
        f.path.includes("src/App.tsx") || f.path.includes("src/main.tsx"),
    );
    if (appTsx) {
      const fileContent = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path: appTsx.path,
      });
      if (fileContent) appRoutes = fileContent.content.slice(0, 2000);
    }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "ci-generator",
      agentName: "CI Generator",
      type: "plan",
      content: `🧪 Generating automated Playwright smoke tests for project endpoints...`,
      isStreaming: false,
    });

    const model = await getModelForRole(ctx, "tester");
    const prompt = `You are a QA / CI Engineer for CodeForge.
Your job is to write a Playwright smoke test script (using Bun) for the following application.

App Routes Context:
${appRoutes}

The test must import { runTest } from "./auth" (assuming it exists in scripts/auth.ts) and use the helper to navigate and take screenshots.
Generate a valid TypeScript file content for 'scripts/e2e/smoke-test.ts'.
Output ONLY the raw file content, inside a markdown code block.`;

    const { text } = await callAIWithFallback(
      [{ role: "user", content: prompt }],
      {
        model,
      },
    );

    let code = text;
    const match = text.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (match) {
      code = match[1]!;
    }

    // Save the file
    const existing = await ctx.runQuery(api.files.getByPath, {
      projectId: args.projectId,
      path: "scripts/e2e/smoke-test.ts",
    });

    if (existing) {
      await ctx.runMutation(api.files.update, {
        fileId: existing._id,
        content: code,
      });
    } else {
      await ctx.runMutation(api.files.create, {
        projectId: args.projectId,
        path: "scripts/e2e/smoke-test.ts",
        name: "smoke-test.ts",
        content: code,
        language: "typescript",
        isDirectory: false,
        parentPath: "scripts/e2e",
      });
    }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "ci-generator",
      agentName: "CI Generator",
      type: "done",
      content: `✅ Generated scripts/e2e/smoke-test.ts successfully.`,
      isStreaming: false,
    });

    return "CI Test Generated";
  },
});
