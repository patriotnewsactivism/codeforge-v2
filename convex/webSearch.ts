/**
 * webSearch.ts — Live Internet Research for CodeForge Agents
 *
 * Ported from Autonomous-Coder's webSearch.ts and adapted for Convex actions.
 *
 * Gives agents the ability to research the web in real-time during builds:
 *   - Primary: Tavily search API (advanced, code-aware, 1000 free searches/month)
 *   - Fallback: DuckDuckGo Instant Answers (no key required)
 *
 * Used by:
 *   - Orchestrator: checks current stack/library versions before planning
 *   - Coder: finds API docs, code examples, implementation patterns
 *   - Debugger: searches for error messages + known fixes
 *   - Reviewer: verifies best practices against current docs
 *
 * Registered as the `web_search` tool in the agent engine.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchBundle {
  query: string;
  results: SearchResult[];
  source: "tavily" | "ddg" | "none";
  tookMs: number;
}

// ─── Tavily (primary, code-aware search) ────────────────────────────────────

async function tavilySearch(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<SearchResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_domains: [
          "github.com",
          "stackoverflow.com",
          "developer.mozilla.org",
          "npmjs.com",
          "docs.rs",
          "react.dev",
          "nextjs.org",
          "vercel.com",
          "tailwindcss.com",
          "typescriptlang.org",
          "nodejs.org",
          "convex.dev",
        ],
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: any[] };
    return (data.results ?? []).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.content ?? "").slice(0, 600),
      score: r.relevance_score,
    }));
  } catch {
    return [];
  }
}

// ─── DuckDuckGo Instant Answers (fallback, no key needed) ───────────────────

async function ddgSearch(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const results: SearchResult[] = [];
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || "",
        content: data.AbstractText.slice(0, 500),
      });
    }
    (data.RelatedTopics ?? []).slice(0, 4).forEach((t: any) => {
      if (t.Text && t.FirstURL) {
        results.push({
          title: t.Text.slice(0, 80),
          url: t.FirstURL,
          content: t.Text.slice(0, 300),
        });
      }
    });
    return results;
  } catch {
    return [];
  }
}

// ─── Main search action ─────────────────────────────────────────────────────

export const search = action({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<SearchBundle> => {
    const maxResults = args.maxResults ?? 6;
    const start = Date.now();

    const tavilyKey = (process.env.TAVILY_API_KEY ?? "").trim();
    if (tavilyKey) {
      const results = await tavilySearch(args.query, maxResults, tavilyKey);
      return {
        query: args.query,
        results,
        source: "tavily",
        tookMs: Date.now() - start,
      };
    }

    const results = await ddgSearch(args.query);
    return {
      query: args.query,
      results,
      source: results.length > 0 ? "ddg" : "none",
      tookMs: Date.now() - start,
    };
  },
});

// ─── Multi-query search (parallel) ──────────────────────────────────────────

export const multiSearch = action({
  args: {
    queries: v.array(v.string()),
    maxPerQuery: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<string> => {
    const maxPerQuery = args.maxPerQuery ?? 4;
    const tavilyKey = (process.env.TAVILY_API_KEY ?? "").trim();

    const bundles = await Promise.all(
      args.queries.map(async (query): Promise<SearchBundle> => {
        const start = Date.now();
        if (tavilyKey) {
          const results = await tavilySearch(query, maxPerQuery, tavilyKey);
          return {
            query,
            results,
            source: "tavily",
            tookMs: Date.now() - start,
          };
        }
        const results = await ddgSearch(query);
        return {
          query,
          results,
          source: results.length > 0 ? "ddg" : "none",
          tookMs: Date.now() - start,
        };
      }),
    );

    return formatSearchResults(bundles);
  },
});

// ─── Query builder for different agent roles ────────────────────────────────

export function buildResearchQueries(
  goal: string,
  agentRole: string,
): string[] {
  const clean = goal
    .slice(0, 120)
    .replace(/\[.*?\]/g, "")
    .trim();

  const queryMap: Record<string, string[]> = {
    orchestrator: [
      `${clean} tech stack 2026`,
      `${clean} architecture best practices`,
    ],
    architect: [
      `${clean} system design patterns`,
      `${clean} architecture decisions`,
    ],
    coder: [
      `${clean} react typescript example`,
      `${clean} code implementation`,
    ],
    debugger: [`${clean} fix solution`, `${clean} stackoverflow`],
    reviewer: [
      `${clean} code review best practices`,
      `${clean} security considerations`,
    ],
    tester: [`${clean} testing strategy`, `${clean} vitest example`],
    devops: [`${clean} deployment configuration`, `${clean} CI/CD setup`],
  };

  return (queryMap[agentRole] || [`${clean}`]).slice(0, 3);
}

// ─── Format search results for agent prompt injection ───────────────────────

export function formatSearchResults(bundles: SearchBundle[]): string {
  const allResults = bundles.flatMap(b => b.results);
  if (allResults.length === 0) return "";

  const lines = ["\n\n🌐 LIVE WEB RESEARCH:"];
  allResults.slice(0, 8).forEach((r, i) => {
    lines.push(`\n[${i + 1}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    lines.push(`${r.content}`);
  });
  lines.push(
    "\n[Use the above real-time data to inform your response. Prefer current sources over training knowledge for APIs, versions, and patterns.]\n",
  );
  return lines.join("\n");
}

// ─── Internal action for engine tool integration ────────────────────────────

export const searchForAgent = internalAction({
  args: {
    query: v.string(),
    agentRole: v.optional(v.string()),
    maxResults: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<string> => {
    const queries = args.agentRole
      ? buildResearchQueries(args.query, args.agentRole)
      : [args.query];

    const maxPerQuery = args.maxResults ?? 4;
    const tavilyKey = (process.env.TAVILY_API_KEY ?? "").trim();

    const bundles = await Promise.all(
      queries.map(async (query): Promise<SearchBundle> => {
        const start = Date.now();
        if (tavilyKey) {
          const results = await tavilySearch(query, maxPerQuery, tavilyKey);
          return {
            query,
            results,
            source: "tavily",
            tookMs: Date.now() - start,
          };
        }
        const results = await ddgSearch(query);
        return {
          query,
          results,
          source: results.length > 0 ? "ddg" : "none",
          tookMs: Date.now() - start,
        };
      }),
    );

    return formatSearchResults(bundles);
  },
});
