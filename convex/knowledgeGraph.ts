/**
 * knowledgeGraph.ts — Project Knowledge Graph
 *
 * Parses project files into a graph of entities (modules, functions, classes,
 * types, components, hooks) and their relationships (imports, calls, inherits,
 * renders). Enables:
 *   - Change impact analysis: "what breaks if I change X?"
 *   - Codebase-aware context: assemble relevant entities for agent prompts
 *   - Intelligent routing: know which files an agent needs to touch
 *   - Auto-update: re-parse on every file write (incremental)
 *
 * Uses regex-based parsing (not a full AST) for speed and zero dependencies.
 * Handles TypeScript/JavaScript/React patterns.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";

// Self-references for pre-codegen compatibility
const selfApi = api as any;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedEntity {
  name: string;
  kind: string;
  startLine: number;
  endLine?: number;
  exports: string[];
  signature?: string;
  docComment?: string;
}

export interface ParsedEdge {
  fromEntity: string;
  toEntity: string;
  relation: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** List all entities in a project, optionally filtered by kind or file. */
export const listEntities = query({
  args: {
    projectId: v.id("projects"),
    kind: v.optional(v.string()),
    filePath: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.filePath) {
      const fp = args.filePath;
      return await ctx.db
        .query("knowledgeEntities")
        .withIndex("by_project_and_file", q =>
          q.eq("projectId", args.projectId).eq("filePath", fp),
        )
        .take(args.limit ?? 100);
    }
    if (args.kind) {
      const k = args.kind;
      return await ctx.db
        .query("knowledgeEntities")
        .withIndex("by_project_and_kind", q =>
          q.eq("projectId", args.projectId).eq("kind", k),
        )
        .take(args.limit ?? 100);
    }
    return await ctx.db
      .query("knowledgeEntities")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .take(args.limit ?? 200);
  },
});

/** Find an entity by name (search across all files). */
export const findEntity = query({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEntities")
      .withIndex("by_project_and_name", q =>
        q.eq("projectId", args.projectId).eq("name", args.name),
      )
      .take(10);
  },
});

/** Get all relationships FROM an entity (what it depends on). */
export const getOutgoingEdges = query({
  args: {
    projectId: v.id("projects"),
    entity: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEdges")
      .withIndex("by_project_and_from", q =>
        q.eq("projectId", args.projectId).eq("fromEntity", args.entity),
      )
      .take(50);
  },
});

/** Get all relationships TO an entity (what depends on it — impact analysis). */
export const getIncomingEdges = query({
  args: {
    projectId: v.id("projects"),
    entity: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEdges")
      .withIndex("by_project_and_to", q =>
        q.eq("projectId", args.projectId).eq("toEntity", args.entity),
      )
      .take(50);
  },
});

/**
 * Change impact analysis: given a file path, find all entities that
 * depend on it (directly or transitively up to 2 hops).
 */
export const getChangeImpact = query({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    depth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDepth = args.depth ?? 2;
    const entitiesInFile = await ctx.db
      .query("knowledgeEntities")
      .withIndex("by_project_and_file", q =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath),
      )
      .collect();

    const impacted = new Set<string>();
    let frontier = entitiesInFile.map(e => `${e.filePath}:${e.name}`);

    for (let d = 0; d < maxDepth; d++) {
      const nextFrontier: string[] = [];
      for (const entity of frontier) {
        const incoming = await ctx.db
          .query("knowledgeEdges")
          .withIndex("by_project_and_to", q =>
            q.eq("projectId", args.projectId).eq("toEntity", entity),
          )
          .collect();
        for (const edge of incoming) {
          if (!impacted.has(edge.fromEntity)) {
            impacted.add(edge.fromEntity);
            nextFrontier.push(edge.fromEntity);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return {
      sourceFile: args.filePath,
      entitiesInFile: entitiesInFile.length,
      impactedEntities: Array.from(impacted),
      impactedCount: impacted.size,
      depth: maxDepth,
    };
  },
});

// ─── Parsing (regex-based, zero-dependency) ─────────────────────────────────

const ENTITY_PATTERNS: { pattern: RegExp; kind: string }[] = [
  { pattern: /export\s+(?:default\s+)?function\s+(\w+)/g, kind: "function" },
  {
    pattern: /export\s+const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])\s*=>/g,
    kind: "function",
  },
  { pattern: /export\s+(?:abstract\s+)?class\s+(\w+)/g, kind: "class" },
  { pattern: /export\s+(?:interface)\s+(\w+)/g, kind: "interface" },
  { pattern: /export\s+type\s+(\w+)/g, kind: "type" },
  {
    pattern:
      /export\s+const\s+(\w+)\s*=\s*(?:query|mutation|action|internalAction|internalMutation|internalQuery)\(/g,
    kind: "function",
  },
  {
    pattern: /export\s+const\s+(\w+)\s*=\s*(?:memo|forwardRef)\(/g,
    kind: "component",
  },
  { pattern: /export\s+function\s+([A-Z]\w+)/g, kind: "component" },
  { pattern: /export\s+const\s+(use\w+)\s*=/g, kind: "hook" },
  { pattern: /export\s+const\s+(\w+)\s*=\s*defineTable\(/g, kind: "type" },
];

const IMPORT_PATTERN =
  /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/g;

export function parseFile(
  filePath: string,
  content: string,
): { entities: ParsedEntity[]; edges: ParsedEdge[] } {
  const entities: ParsedEntity[] = [];
  const edges: ParsedEdge[] = [];
  const seen = new Set<string>();

  // Extract entities
  for (const { pattern, kind } of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    match = pattern.exec(content);
    while (match !== null) {
      const name = match[1];
      if (!name || seen.has(name)) {
        match = pattern.exec(content);
        continue;
      }
      seen.add(name);

      const startLine = content.slice(0, match.index).split("\n").length;

      // Extract doc comment (look backwards for /** ... */)
      let docComment: string | undefined;
      const preceding = content.slice(
        Math.max(0, match.index - 500),
        match.index,
      );
      const docMatch = preceding.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
      if (docMatch)
        docComment = docMatch[1]
          .trim()
          .replace(/\n\s*\*\s*/g, " ")
          .slice(0, 200);

      entities.push({
        name,
        kind,
        startLine,
        exports: [name],
        signature: match[0].slice(0, 150),
        docComment,
      });
      match = pattern.exec(content);
    }
  }

  // Extract import edges
  const moduleEntity = `${filePath}:*`;
  IMPORT_PATTERN.lastIndex = 0;
  let importMatch: RegExpExecArray | null;
  importMatch = IMPORT_PATTERN.exec(content);
  while (importMatch !== null) {
    const namedImports = importMatch[1];
    const defaultImport = importMatch[2];
    const fromPath = importMatch[3];

    // Resolve relative paths
    const resolvedPath = fromPath.startsWith(".")
      ? resolveRelativePath(filePath, fromPath)
      : fromPath; // external package

    if (namedImports) {
      for (const name of namedImports.split(",").map(s =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .replace(/^type\s+/, ""),
      )) {
        if (name && name !== "type") {
          edges.push({
            fromEntity: moduleEntity,
            toEntity: `${resolvedPath}:${name}`,
            relation: "imports",
          });
        }
      }
    }
    if (defaultImport) {
      edges.push({
        fromEntity: moduleEntity,
        toEntity: `${resolvedPath}:${defaultImport}`,
        relation: "imports",
      });
    }
    importMatch = IMPORT_PATTERN.exec(content);
  }

  return { entities, edges };
}

function resolveRelativePath(fromFile: string, importPath: string): string {
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const parts = (fromDir ? `${fromDir}/${importPath}` : importPath).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  let result = resolved.join("/");
  // Add .ts/.tsx extension if missing
  if (!result.match(/\.\w+$/)) result += ".ts";
  return result;
}

// ─── Actions ────────────────────────────────────────────────────────────────

/** Parse a single file and update the knowledge graph (incremental). */
export const indexFile = action({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    content: v.string(),
  },
  returns: v.object({ entities: v.number(), edges: v.number() }),
  handler: async (ctx, args): Promise<{ entities: number; edges: number }> => {
    // Skip non-code files
    if (!args.filePath.match(/\.(ts|tsx|js|jsx)$/))
      return { entities: 0, edges: 0 };

    const { entities, edges } = parseFile(args.filePath, args.content);

    // Clear old entities/edges for this file, then insert new ones
    await ctx.runMutation(selfApi.knowledgeGraph.replaceFileEntities, {
      projectId: args.projectId,
      filePath: args.filePath,
      entities: entities.map(e => ({
        name: e.name,
        kind: e.kind,
        startLine: e.startLine,
        endLine: e.endLine,
        exports: e.exports,
        signature: e.signature,
        docComment: e.docComment,
      })),
      edges: edges.map(e => ({
        fromEntity: e.fromEntity,
        toEntity: e.toEntity,
        relation: e.relation,
      })),
    });

    return { entities: entities.length, edges: edges.length };
  },
});

/** Re-index all files in a project (full rebuild). */
export const indexProject = action({
  args: { projectId: v.id("projects") },
  returns: v.object({
    filesIndexed: v.number(),
    totalEntities: v.number(),
    totalEdges: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    filesIndexed: number;
    totalEntities: number;
    totalEdges: number;
  }> => {
    const files: any[] = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });

    let totalEntities = 0;
    let totalEdges = 0;
    let filesIndexed = 0;

    for (const file of files) {
      if (file.isDirectory || !file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
      const result = await ctx.runAction(selfApi.knowledgeGraph.indexFile, {
        projectId: args.projectId,
        filePath: file.path,
        content: file.content ?? "",
      });
      totalEntities += result.entities;
      totalEdges += result.edges;
      filesIndexed++;
    }

    return { filesIndexed, totalEntities, totalEdges };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Replace all entities and edges for a file (atomic update). */
export const replaceFileEntities = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    entities: v.array(
      v.object({
        name: v.string(),
        kind: v.string(),
        startLine: v.optional(v.number()),
        endLine: v.optional(v.number()),
        exports: v.optional(v.array(v.string())),
        signature: v.optional(v.string()),
        docComment: v.optional(v.string()),
      }),
    ),
    edges: v.array(
      v.object({
        fromEntity: v.string(),
        toEntity: v.string(),
        relation: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Delete old entities for this file
    const oldEntities = await ctx.db
      .query("knowledgeEntities")
      .withIndex("by_project_and_file", q =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath),
      )
      .collect();
    for (const e of oldEntities) await ctx.db.delete(e._id);

    // Delete old edges from this file
    const moduleEntity = `${args.filePath}:*`;
    const oldEdges = await ctx.db
      .query("knowledgeEdges")
      .withIndex("by_project_and_from", q =>
        q.eq("projectId", args.projectId).eq("fromEntity", moduleEntity),
      )
      .collect();
    for (const e of oldEdges) await ctx.db.delete(e._id);

    // Insert new entities
    for (const entity of args.entities) {
      await ctx.db.insert("knowledgeEntities", {
        projectId: args.projectId,
        filePath: args.filePath,
        name: entity.name,
        kind: entity.kind,
        startLine: entity.startLine,
        endLine: entity.endLine,
        exports: entity.exports,
        signature: entity.signature,
        docComment: entity.docComment,
        lastModified: Date.now(),
      });
    }

    // Insert new edges
    for (const edge of args.edges) {
      await ctx.db.insert("knowledgeEdges", {
        projectId: args.projectId,
        fromEntity: edge.fromEntity,
        toEntity: edge.toEntity,
        relation: edge.relation,
      });
    }
  },
});
