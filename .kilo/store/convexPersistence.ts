import fs from "fs";
import path from "path";

// lazy import Convex client
let _client: any = null;
let _convexAvailable = false;
const _templatesPath = path.resolve(__dirname, "../templates.json");
const _kbPath = path.resolve(__dirname, "../knowledgeBase.json");

function localTemplatesPath(): string {
  return _templatesPath;
}
function localKbPath(): string {
  return _kbPath;
}

async function resolveClient(): Promise<any> {
  if (_client) return _client;
  try {
    const { createConvexClient } = require("./convexClient");
    const cfgPath = path.resolve(__dirname, "convexConfig.json");
    let addr: string | undefined;
    if (fs.existsSync(cfgPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        addr = c.address;
      } catch {}
    }
    if (!addr) addr = process.env.CONVEX_ADDRESS;
    if (!addr) addr = "https://honorable-finch-460.convex.cloud";
    const client = createConvexClient(addr);
    // quick ping check
    if (client && typeof client.query === "function") {
      await client.query("templates.list", {});
      _client = client;
      _convexAvailable = true;
      return client;
    }
  } catch {
    // fall through to local
  }
  _client = null;
  _convexAvailable = false;
  return null;
}

export async function isConvexAvailable(): Promise<boolean> {
  await resolveClient();
  return _convexAvailable;
}

async function ensureConvexClient(): Promise<any> {
  const c = await resolveClient();
  return c;
}

// Local storage fallbacks
async function loadTemplatesLocal(): Promise<any[]> {
  const fp = localTemplatesPath();
  if (!fs.existsSync(fp)) {
    const defaults = [
      {
        id: "FrontendCadet",
        domain: "frontend",
        promptTemplate: "You are Frontend Cadet. Task: {task.description}.",
        tools: ["lint", "typecheck"],
        successCriteria: "build+tests",
      },
      {
        id: "BackendCadet",
        domain: "backend",
        promptTemplate: "You are Backend Cadet. Task: {task.description}.",
        tools: ["lint", "typecheck"],
        successCriteria: "build+tests",
      },
      {
        id: "TestsCadet",
        domain: "tests",
        promptTemplate: "You are Tests Cadet. Task: {task.description}.",
        tools: ["test-runner"],
        successCriteria: "tests pass",
      },
    ];
    fs.writeFileSync(fp, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
  const raw = fs.readFileSync(fp, "utf8");
  return JSON.parse(raw);
}

async function writeTemplatesLocal(templates: any[]): Promise<void> {
  fs.writeFileSync(
    localTemplatesPath(),
    JSON.stringify(templates, null, 2),
    "utf8",
  );
}

function localTemplatesPath(): string {
  return localTemplatesPathInternal();
}
function localTemplatesPathInternal(): string {
  return _templatesPath;
}

export async function loadTemplates(): Promise<any[]> {
  if (await isConvexAvailable()) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.query === "function") {
        const data = await client.query("templates.list", {});
        return (data as any[]) ?? [];
      }
    } catch {
      /* fall back */
    }
  }
  return await loadTemplatesLocal();
}

export async function upsertTemplate(template: any): Promise<void> {
  if (await isConvexAvailable()) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.mutate === "function") {
        await client.mutate("templates.upsert", template);
        return;
      }
    } catch {
      /* fallback */
    }
  }
  const curr = await loadTemplatesLocal();
  const idx = curr.findIndex((t: any) => t.id === template.id);
  if (idx >= 0) curr[idx] = template;
  else curr.push(template);
  await writeTemplatesLocal(curr);
}

async function loadKnowledgeLocal(): Promise<any[]> {
  const kbPath = _kbPath;
  if (!fs.existsSync(kbPath)) return [];
  const raw = fs.readFileSync(kbPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeKnowledgeLocal(entries: any[]): Promise<void> {
  fs.writeFileSync(_kbPath, JSON.stringify(entries, null, 2), "utf8");
}

export async function loadKnowledge(): Promise<any[]> {
  if (await isConvexAvailable()) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.query === "function") {
        const data = await client.query("knowledge.list", {});
        return (data as any[]) ?? [];
      }
    } catch {
      /* fallback */
    }
  }
  return await loadKnowledgeLocal();
}

export async function upsertKnowledge(entry: any): Promise<void> {
  if (await isConvexAvailable()) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.mutate === "function") {
        await client.mutate("knowledge.upsert", entry);
        return;
      }
    } catch {
      /* fallback */
    }
  }
  const curr = await loadKnowledgeLocal();
  curr.push(entry);
  await writeKnowledgeLocal(curr);
}

export async function migrateLocalToConvex(): Promise<void> {
  if (!(await isConvexAvailable())) return;
  // migrate templates
  const local = await loadTemplatesLocal();
  for (const t of local) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.mutate === "function") {
        await client.mutate("templates.upsert", t);
      }
    } catch {
      /* ignore */
    }
  }
  const localKb = await loadKnowledgeLocal();
  for (const k of localKb) {
    try {
      const client =
        await require("./convexClient").createConvexClient("https://default");
      if (client && typeof client.mutate === "function") {
        await client.mutate("knowledge.upsert", k);
      }
    } catch {
      /* ignore */
    }
  }
}

export async function isLifetimeConvexUsed(): Promise<boolean> {
  return await isConvexAvailable();
}
