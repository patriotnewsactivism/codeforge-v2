"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

export const deploy = action({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.object({ url: v.string(), deploymentId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) throw new Error("VERCEL_TOKEN not configured");

    const project = await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");

    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });

    const deploymentName = project.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");

    const createRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: deploymentName,
        files: files
          .filter((f: any) => !f.isDirectory)
          .map((f: any) => ({
            file: f.path.startsWith("/") ? f.path : `/${f.path}`,
            data: f.content,
            encoding: "utf-8",
          })),
        projectSettings: {
          framework: files.some((f: any) => f.path === "vite.config.ts" || f.path === "vite.config.js") 
            ? "vite" 
            : files.some((f: any) => f.path === "package.json") 
              ? null 
              : null,
          buildCommand: files.some((f: any) => f.path === "package.json") ? "npm run build" : "",
          outputDirectory: files.some((f: any) => f.path === "vite.config.ts" || f.path === "vite.config.js") ? "dist" : "",
        },
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(
        `Vercel deployment failed: ${createRes.status} ${errText}`,
      );
    }

    const deployment = (await createRes.json()) as { id: string; url: string };

    await ctx.runMutation(api.gitops.recordDeployment, {
      projectId: args.projectId,
      platform: "vercel",
      deploymentId: deployment.id,
      url: `https://${deployment.url}`,
      status: "deployed",
      filesCount: files.length,
    });

    return {
      url: `https://${deployment.url}`,
      deploymentId: deployment.id,
    };
  },
});

export const getStatus = action({
  args: {
    deploymentId: v.string(),
  },
  handler: async (ctx, args) => {
    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) throw new Error("VERCEL_TOKEN not configured");

    const res = await fetch(
      `https://api.vercel.com/v13/deployments/${args.deploymentId}`,
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch Vercel status: ${res.status}`);
    }

    return (await res.json()) as {
      readyState: string;
      url: string;
      error?: { code: string; message: string };
    };
  },
});

