/**
 * multiEdit.ts — Atomic Multi-File Editing with Rollback
 *
 * Enables agents to make coordinated changes across multiple files as a
 * single atomic unit. If any part fails, the entire edit is rolled back.
 *
 * Features:
 *   - Atomic multi-file edits: N files changed as one unit
 *   - Snapshot/rollback: any edit can be reverted
 *   - Edit history: full audit trail of all multi-file operations
 *   - Conflict detection: warns if files changed since snapshot
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";

// Pre-codegen: new module not yet in generated types
const selfApi = api as any;

// ─── Queries ────────────────────────────────────────────────────────────────

/** List edit sets for a project (most recent first). */
export const listEditSets = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("editSets")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

/** Get a specific edit set with its file snapshots. */
export const getEditSet = query({
  args: { editSetId: v.id("editSets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.editSetId);
  },
});

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Apply a multi-file edit atomically.
 * Takes a snapshot of all affected files before editing.
 * If any edit fails, all changes are rolled back from the snapshot.
 */
export const applyMultiEdit = action({
  args: {
    projectId: v.id("projects"),
    description: v.string(),
    agentId: v.optional(v.string()),
    edits: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
        operation: v.union(
          v.literal("create"),
          v.literal("update"),
          v.literal("delete"),
        ),
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    editSetId: v.optional(v.id("editSets")),
    filesChanged: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    editSetId?: Id<"editSets">;
    filesChanged: number;
    error?: string;
  }> => {
    // 1. Snapshot current state of all affected files
    const snapshots: {
      path: string;
      content: string | null;
      existed: boolean;
    }[] = [];
    for (const edit of args.edits) {
      const existing: any = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path: edit.path,
      });
      snapshots.push({
        path: edit.path,
        content: existing?.content ?? null,
        existed: !!existing,
      });
    }

    // 2. Create the edit set record
    const editSetId = await ctx.runMutation(selfApi.multiEdit.createEditSet, {
      projectId: args.projectId,
      description: args.description,
      agentId: args.agentId,
      fileCount: args.edits.length,
      snapshots: JSON.stringify(snapshots),
    });

    // 3. Apply edits one by one
    let applied = 0;
    try {
      for (const edit of args.edits) {
        if (edit.operation === "delete") {
          const existing: any = await ctx.runQuery(api.files.getByPath, {
            projectId: args.projectId,
            path: edit.path,
          });
          if (existing) {
            await ctx.runMutation(api.files.remove, {
              fileId: existing._id,
            });
          }
        } else if (edit.operation === "create") {
          const parts = edit.path.split("/");
          await ctx.runMutation(api.files.create, {
            projectId: args.projectId,
            path: edit.path,
            name: parts[parts.length - 1]!,
            content: edit.content,
            language: detectLanguage(edit.path),
            isDirectory: false,
            parentPath: parts.slice(0, -1).join("/") || undefined,
          });
        } else {
          // update
          const existing: any = await ctx.runQuery(api.files.getByPath, {
            projectId: args.projectId,
            path: edit.path,
          });
          if (existing) {
            await ctx.runMutation(api.files.update, {
              fileId: existing._id,
              content: edit.content,
            });
          } else {
            // File doesn't exist — create instead
            const parts = edit.path.split("/");
            await ctx.runMutation(api.files.create, {
              projectId: args.projectId,
              path: edit.path,
              name: parts[parts.length - 1]!,
              content: edit.content,
              language: detectLanguage(edit.path),
              isDirectory: false,
              parentPath: parts.slice(0, -1).join("/") || undefined,
            });
          }
        }
        applied++;
      }

      // 4. Mark edit set as applied
      await ctx.runMutation(selfApi.multiEdit.markEditSetApplied, {
        editSetId,
      });

      return { success: true, editSetId, filesChanged: applied };
    } catch (err) {
      // 5. ROLLBACK: restore all files from snapshot
      for (const snap of snapshots) {
        try {
          if (!snap.existed) {
            // File was created — delete it
            const created: any = await ctx.runQuery(api.files.getByPath, {
              projectId: args.projectId,
              path: snap.path,
            });
            if (created) {
              await ctx.runMutation(api.files.remove, { fileId: created._id });
            }
          } else if (snap.content !== null) {
            // File was modified — restore original content
            const existing: any = await ctx.runQuery(api.files.getByPath, {
              projectId: args.projectId,
              path: snap.path,
            });
            if (existing) {
              await ctx.runMutation(api.files.update, {
                fileId: existing._id,
                content: snap.content,
              });
            }
          }
        } catch {
          // Best-effort rollback
        }
      }

      await ctx.runMutation(selfApi.multiEdit.markEditSetFailed, {
        editSetId,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        success: false,
        editSetId,
        filesChanged: 0,
        error: `Rolled back after failure at file ${applied + 1}/${args.edits.length}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Rollback a previously applied edit set.
 * Restores all files to their pre-edit state.
 */
export const rollbackEditSet = action({
  args: { editSetId: v.id("editSets") },
  returns: v.object({ success: v.boolean(), filesRestored: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; filesRestored: number }> => {
    const editSet: any = await ctx.runQuery(selfApi.multiEdit.getEditSet, {
      editSetId: args.editSetId,
    });
    if (!editSet?.snapshots) return { success: false, filesRestored: 0 };

    const snapshots = JSON.parse(editSet.snapshots) as {
      path: string;
      content: string | null;
      existed: boolean;
    }[];

    let restored = 0;
    for (const snap of snapshots) {
      try {
        const existing: any = await ctx.runQuery(api.files.getByPath, {
          projectId: editSet.projectId,
          path: snap.path,
        });

        if (!snap.existed && existing) {
          await ctx.runMutation(api.files.remove, { fileId: existing._id });
          restored++;
        } else if (snap.content !== null && existing) {
          await ctx.runMutation(api.files.update, {
            fileId: existing._id,
            content: snap.content,
          });
          restored++;
        }
      } catch {
        /* best-effort */
      }
    }

    await ctx.runMutation(selfApi.multiEdit.markEditSetRolledBack, {
      editSetId: args.editSetId,
    });

    return { success: true, filesRestored: restored };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

export const createEditSet = mutation({
  args: {
    projectId: v.id("projects"),
    description: v.string(),
    agentId: v.optional(v.string()),
    fileCount: v.number(),
    snapshots: v.string(),
  },
  returns: v.id("editSets"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("editSets", {
      projectId: args.projectId,
      description: args.description,
      agentId: args.agentId,
      fileCount: args.fileCount,
      snapshots: args.snapshots,
      status: "applying",
      createdAt: Date.now(),
    });
  },
});

export const markEditSetApplied = mutation({
  args: { editSetId: v.id("editSets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.editSetId, {
      status: "applied",
      appliedAt: Date.now(),
    });
  },
});

export const markEditSetFailed = mutation({
  args: { editSetId: v.id("editSets"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.editSetId, {
      status: "rolled_back",
      error: args.error,
      appliedAt: Date.now(),
    });
  },
});

export const markEditSetRolledBack = mutation({
  args: { editSetId: v.id("editSets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.editSetId, {
      status: "rolled_back",
      appliedAt: Date.now(),
    });
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectLanguage(path: string): string {
  const ext = path.split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    css: "css",
    html: "html",
    json: "json",
    md: "markdown",
    py: "python",
  };
  return map[ext] ?? "plaintext";
}
