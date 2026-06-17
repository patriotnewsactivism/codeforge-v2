/**
 * repoImport.ts — One-Click Repo Import → Running App
 *
 * Point CodeForge at any public GitHub repo URL.
 * It imports the code, runs the Architect to understand the structure,
 * builds a project brief, and lets you start giving orders immediately.
 *
 * Steps:
 *   1. Parse the GitHub URL → owner/repo/branch
 *   2. Import all code files (up to 250 files, <100KB each)
 *   3. Architect agent reads structure → generates a PROJECT_BRIEF.md
 *   4. RAG index built from imported files (for semantic search)
 *   5. Tech stack auto-detected → cross-project insights injected
 *   6. Project is "ready" — user can now say "add dark mode" and agents execute
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

declare const process: { env: Record<string, string | undefined> };
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// ─── DB ──────────────────────────────────────────────────────────────────────

export const saveImportJob = mutation({
  args: {
    projectId: v.id("projects"),
    repoUrl: v.string(),
    repoFullName: v.string(),
    branch: v.string(),
    status: v.string(), // "queued" | "cloning" | "indexing" | "analyzing" | "ready" | "failed"
    filesImported: v.optional(v.number()),
    detectedStack: v.optional(v.array(v.string())),
    briefGenerated: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.id("importJobs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("importJobs", {
      ...args,
      startedAt: Date.now(),
    });
  },
});

export const updateImportJob = mutation({
  args: {
    jobId: v.id("importJobs"),
    status: v.optional(v.string()),
    filesImported: v.optional(v.number()),
    detectedStack: v.optional(v.array(v.string())),
    briefGenerated: v.optional(v.boolean()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { jobId, ...patch } = args;
    await ctx.db.patch(
      jobId,
      Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ),
    );
    return null;
  },
});

export const getImportJob = query({
  args: { jobId: v.id("importJobs") },
  handler: async (ctx, args) => ctx.db.get(args.jobId),
});

export const listImportJobs = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("importJobs")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(10);
  },
});

// ─── HELPER: Detect tech stack from file list ─────────────────────────────────

function detectStack(filePaths: string[]): string[] {
  const stack: string[] = [];
  const joined = filePaths.join("\n");

  if (joined.includes("package.json")) stack.push("node");
  if (joined.match(/\.(tsx?|jsx?)$/m)) {
    if (joined.includes("react")) stack.push("react");
    stack.push("typescript");
  }
  if (joined.includes("next.config")) stack.push("nextjs");
  if (joined.includes("vite.config")) stack.push("vite");
  if (joined.includes("convex/")) stack.push("convex");
  if (joined.includes("prisma/")) stack.push("prisma");
  if (joined.includes("tailwind.config")) stack.push("tailwind");
  if (joined.includes("requirements.txt") || joined.includes("setup.py"))
    stack.push("python");
  if (joined.includes("Cargo.toml")) stack.push("rust");
  if (joined.includes("go.mod")) stack.push("go");
  if (joined.includes("pom.xml") || joined.includes("build.gradle"))
    stack.push("java");
  if (joined.includes("Dockerfile") || joined.includes("docker-compose"))
    stack.push("docker");

  return [...new Set(stack)];
}

// ─── CORE ACTION: importRepo ──────────────────────────────────────────────────

export const importRepo = action({
  args: {
    projectId: v.id("projects"),
    repoUrl: v.string(), // https://github.com/owner/repo or owner/repo
    branch: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    jobId: v.id("importJobs"),
    filesImported: v.number(),
    detectedStack: v.array(v.string()),
    brief: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // ── Parse repo URL ────────────────────────────────────────────────────
    const urlMatch = args.repoUrl.match(/github\.com\/([^/]+\/[^/\s]+)/);
    const repoFullName = urlMatch
      ? urlMatch[1].replace(/\.git$/, "")
      : args.repoUrl
          .replace(/^https?:\/\/github\.com\//, "")
          .replace(/\.git$/, "");

    if (!repoFullName.includes("/")) {
      const jobId = await ctx.runMutation(api.repoImport.saveImportJob, {
        projectId: args.projectId,
        repoUrl: args.repoUrl,
        repoFullName: args.repoUrl,
        branch: "main",
        status: "failed",
        error: "Invalid GitHub URL. Use: https://github.com/owner/repo",
      });
      return {
        jobId,
        filesImported: 0,
        detectedStack: [],
        brief: "",
        success: false,
        error: "Invalid GitHub URL",
      };
    }

    const jobId = await ctx.runMutation(api.repoImport.saveImportJob, {
      projectId: args.projectId,
      repoUrl: args.repoUrl,
      repoFullName,
      branch: args.branch ?? "main",
      status: "cloning",
    });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "repo-import",
      agentName: "📦 Repo Import",
      type: "action",
      content: `Cloning ${repoFullName}…`,
      isStreaming: false,
    });

    try {
      // ── Clone via GitHub API ──────────────────────────────────────────
      const importResult = await ctx.runAction(api.git.importFromGitHub, {
        projectId: args.projectId,
        repoFullName,
        branch: args.branch,
      });

      if (!importResult.success) {
        await ctx.runMutation(api.repoImport.updateImportJob, {
          jobId,
          status: "failed",
          error: importResult.error,
        });
        return {
          jobId,
          filesImported: 0,
          detectedStack: [],
          brief: "",
          success: false,
          error: importResult.error,
        };
      }

      // ── Detect stack ──────────────────────────────────────────────────
      const allFiles = await ctx.runQuery(api.files.listByProject, {
        projectId: args.projectId,
      });
      const filePaths = allFiles
        .filter((f: any) => !f.isDirectory)
        .map((f: any) => f.path);
      const detectedStack = detectStack(filePaths);

      await ctx.runMutation(api.repoImport.updateImportJob, {
        jobId,
        status: "analyzing",
        filesImported: importResult.filesImported,
        detectedStack,
      });

      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "repo-import",
        agentName: "📦 Repo Import",
        type: "action",
        content: `Imported ${importResult.filesImported} files. Stack: ${detectedStack.join(", ")}. Generating project brief…`,
        isStreaming: false,
      });

      // ── Generate PROJECT_BRIEF.md via Architect ───────────────────────
      // Sample key files for analysis
      const keyFileNames = [
        "README.md",
        "package.json",
        "convex/schema.ts",
        "src/App.tsx",
        "main.py",
        "go.mod",
        "Cargo.toml",
      ];
      const keyFiles = allFiles
        .filter((f: any) => keyFileNames.some(k => f.path.endsWith(k)))
        .slice(0, 5);

      const fileSnippets = await Promise.all(
        keyFiles.map(async (f: any) => {
          const full = await ctx.runQuery(api.files.getByPath, {
            projectId: args.projectId,
            path: f.path,
          });
          return `### ${f.path}\n\`\`\`\n${(full as any)?.content?.slice(0, 1000) ?? ""}\n\`\`\``;
        }),
      );

      const briefPrompt = `You are the Architect agent in CodeForge. You've just imported a GitHub repository.
Your job: write a comprehensive PROJECT_BRIEF.md that future agents will read before working on this codebase.

Repository: ${repoFullName}
Files imported: ${importResult.filesImported}
Tech stack detected: ${detectedStack.join(", ")}
Total files: ${filePaths.length}

Key file samples:
${fileSnippets.join("\n\n")}

File structure overview (first 50):
${filePaths.slice(0, 50).join("\n")}

Write a PROJECT_BRIEF.md with these sections:
1. **Project Overview** — what this project does in 2-3 sentences
2. **Tech Stack** — exact technologies, versions if visible
3. **Architecture** — how the codebase is organized, key directories
4. **Entry Points** — where the app starts, main files to know
5. **Key Patterns** — coding conventions, naming patterns observed
6. **Data Models** — key data structures / schemas if visible
7. **Known Gotchas** — anything a developer should watch out for
8. **Development Commands** — how to run/build/test (from README/package.json)

Be specific and technical. This is for AI agents, not humans. Mention exact file paths.`;

      const { text: brief } = await callAIWithFallback(briefPrompt, {
        model: getModelForRole("architect"),
        temperature: 0.2,
      });

      // Save the brief as a file in the project
      const existingBrief = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path: "PROJECT_BRIEF.md",
      });

      if (existingBrief) {
        await ctx.runMutation(api.files.updateContent, {
          fileId: (existingBrief as any)._id,
          content: brief,
        });
      } else {
        await ctx.runMutation(api.files.create, {
          projectId: args.projectId,
          path: "PROJECT_BRIEF.md",
          name: "PROJECT_BRIEF.md",
          content: brief,
          isDirectory: false,
        });
      }

      // ── Inject cross-project insights if user provided ────────────────
      if (args.userId) {
        await ctx.runAction(api.crossProject.injectCrossProjectContext, {
          userId: args.userId,
          projectId: args.projectId,
          taskDescription: `Work on ${repoFullName}`,
          techStack: detectedStack,
        });
      }

      await ctx.runMutation(api.repoImport.updateImportJob, {
        jobId,
        status: "ready",
        briefGenerated: true,
        completedAt: Date.now(),
      });

      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "repo-import",
        agentName: "📦 Repo Import",
        type: "complete",
        content: `✅ ${repoFullName} is ready. ${importResult.filesImported} files imported, PROJECT_BRIEF.md generated. Start giving orders!`,
        isStreaming: false,
      });

      return {
        jobId,
        filesImported: importResult.filesImported,
        detectedStack,
        brief,
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.repoImport.updateImportJob, {
        jobId,
        status: "failed",
        error,
      });
      return {
        jobId,
        filesImported: 0,
        detectedStack: [],
        brief: "",
        success: false,
        error,
      };
    }
  },
});
