import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const srcRoot = join(root, "src");

const supported = new Set([
  "auth.currentUser",
  "auth.enabledOAuthProviders",
  "memory.listMemories",
  "memory.listRetrospectives",
  "memory.listAgentMessages",
  "memory.getMemoryStats",
  "memory.deleteMemory",
  "memory.approveMemory",
  "tasks.listTasks",
  "missions.listByProject",
  "buildLoop.getActiveSession",
  "buildLoop.listSteps",
  "agentThoughts.listRecent",
  "intelligence.listAgentTasks",
  "intelligence.listBuildSessions",
  "intelligence.listThoughts",
  "intelligence.listAgentMessages",
  "intelligence.listToolCalls",
  "intelligence.getCostSummary",
  "changeHistory.listByProject",
  "changeHistory.undoChange",
  "suggestions.listByProject",
  "suggestions.updateStatus",
  "suggestions.getAutonomousMode",
  "suggestions.setAutonomousMode",
  "collaboration.heartbeat",
  "collaboration.listActive",
  "collaboration.leave",
  "collaboration.createInvite",
  "collaboration.joinByInvite",
  "engine.listToolCalls",
  "codeReview.listReviews",
  "xray.getLatestXRay",
  "completionScore.getLatestScores",
  "costEntries.listByProject",
  "dashboard.getDashboard",
  "chat.listModels",
  "limits.getMyLimits",
  "projects.list",
  "projects.get",
  "projects.create",
  "projects.remove",
  "projects.updateLastOpened",
  "projects.setGithubRepo",
  "files.listByProject",
  "files.getByPath",
  "files.updateContent",
  "files.create",
  "files.rename",
  "files.remove",
  "files.update",
  "files.bulkInsert",
  "chat.getSession",
  "chat.getOrCreateSession",
  "chat.createSession",
  "chat.listSessions",
  "chat.renameSession",
  "chat.deleteSession",
  "chat.archiveSession",
  "chat.updateModel",
  "chat.listMessages",
  "chat.addMessage",
  "users.getProfile",
  "users.completeOnboarding",
  "users.updateAiProfile",
  "users.deleteAccount",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
      continue;
    }

    if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const used = new Map();
const apiCallPattern = /\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;

for (const path of await walk(srcRoot)) {
  const source = await readFile(path, "utf8");

  for (const match of source.matchAll(apiCallPattern)) {
    const name = `${match[1]}.${match[2]}`;
    const paths = used.get(name) ?? new Set();
    paths.add(path);
    used.set(name, paths);
  }
}

const unsupported = [...used.keys()]
  .filter((name) => !supported.has(name))
  .sort();

console.log(`RPCs referenced by frontend: ${used.size}`);
console.log(`RPCs implemented by PostgreSQL bridge: ${[...used.keys()].filter((name) => supported.has(name)).length}`);

if (unsupported.length > 0) {
  console.error("\nUnsupported RPCs blocking full Convex cutover:");

  for (const name of unsupported) {
    console.error(`- ${name}`);

    for (const path of used.get(name) ?? []) {
      console.error(`    ${path}`);
    }
  }

  process.exit(1);
}

console.log("PASS: every statically referenced api.<module>.<function> RPC is implemented.");
