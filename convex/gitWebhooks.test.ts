/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("git webhooks & conflict detection", () => {
  test("identifies merge conflict when same file was modified differently", async () => {
    const t = convexTest(schema, modules);

    const analysis = await t.query(api.gitWebhooks.detectBranchConflicts, {
      baseBranch: "main",
      headBranch: "feature/agent-replay",
      baseFiles: [
        { path: "src/App.tsx", hash: "hash_base_app" },
        { path: "package.json", hash: "hash_pkg" },
      ],
      headFiles: [
        { path: "src/App.tsx", hash: "hash_head_app" },
        { path: "package.json", hash: "hash_pkg" },
      ],
      ancestorFiles: [
        { path: "src/App.tsx", hash: "hash_ancestor_app" },
        { path: "package.json", hash: "hash_pkg" },
      ],
    });

    expect(analysis.hasConflict).toBe(true);
    expect(analysis.conflictingFiles).toContain("src/App.tsx");
  });

  test("reports clean merge when no divergent modifications exist", async () => {
    const t = convexTest(schema, modules);

    const analysis = await t.query(api.gitWebhooks.detectBranchConflicts, {
      baseBranch: "main",
      headBranch: "feature/clean-branch",
      baseFiles: [{ path: "src/main.tsx", hash: "hash_1" }],
      headFiles: [{ path: "src/main.tsx", hash: "hash_1" }],
    });

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.conflictingFiles).toHaveLength(0);
  });
});
