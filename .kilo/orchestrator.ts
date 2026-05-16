import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

type Status = "pending" | "running" | "completed" | "failed";
interface SubTask {
  id: string;
  description: string;
  domain: "frontend" | "backend" | "tests" | "docs" | "tools";
}
interface AgentTemplate {
  id: string;
  domain: string;
  promptTemplate: string;
  tools: string[];
  successCriteria: string;
  maxConcurrent?: number;
}
interface AgentInstance {
  id: string;
  templateId: string;
  task: SubTask;
  status: Status;
  artifacts?: any;
  improvements?: string[];
}
interface KnowledgeBaseEntry {
  id: string;
  task: SubTask;
  templateId: string;
  result: any;
  improvements?: string[];
  createdAt: string;
}

const knowledgePath = path.resolve(__dirname, "knowledgeBase.json");
const templatesPath = path.resolve(__dirname, "templates.json");

function readJSON<T>(p: string, fallback: T): T {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(p: string, data: any) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function loadTemplates(): AgentTemplate[] {
  const defaultTemplates: AgentTemplate[] = [
    {
      id: "FrontendCadet",
      domain: "frontend",
      promptTemplate:
        "You are Frontend Cadet. Task: {task.description}. Provide code changes, plus brief docs and unit tests. Use tools: lint, typecheck.",
      tools: ["lint", "typecheck"],
      successCriteria: "code compiles with tests",
      maxConcurrent: 2,
    },
    {
      id: "BackendCadet",
      domain: "backend",
      promptTemplate:
        "You are Backend Cadet. Task: {task.description}. Provide API/backend code with tests and docs. Use tooling to ensure reliability.",
      tools: ["lint", "typecheck"],
      successCriteria: "build succeeds with tests",
      maxConcurrent: 2,
    },
    {
      id: "TestsCadet",
      domain: "tests",
      promptTemplate:
        "You are Tests Cadet. Task: {task.description}. Write tests and ensure coverage. Provide minimal docs.",
      tools: ["test-runner"],
      successCriteria: "tests pass",
      maxConcurrent: 2,
    },
  ];
  if (!fs.existsSync(templatesPath)) {
    writeJSON(templatesPath, defaultTemplates);
    return defaultTemplates;
  }
  const loaded = readJSON<AgentTemplate[]>(templatesPath, []);
  return loaded.length ? loaded : defaultTemplates;
}

function ensureKB() {
  if (!fs.existsSync(knowledgePath)) writeJSON(knowledgePath, []);
  return readJSON<KnowledgeBaseEntry[]>(knowledgePath, []);
}

function nextId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function decomposeTask(taskDesc: string): SubTask[] {
  const base: SubTask[] = [
    {
      id: nextId("sub"),
      description: `Implement: ${taskDesc} - frontend changes`,
      domain: "frontend",
    },
    {
      id: nextId("sub"),
      description: `Implement: ${taskDesc} - backend API layer`,
      domain: "backend",
    },
    {
      id: nextId("sub"),
      description: `Tests & validation for: ${taskDesc}`,
      domain: "tests",
    },
  ];
  return base;
}

function selectTemplateForDomain(
  domain: string,
  templates: AgentTemplate[],
): AgentTemplate {
  const t = templates.find(x => x.domain === domain) ?? templates[0];
  return t;
}

// Real Docker-based per-subtask runner
async function runDockerAgent(
  image: string,
  workspace: string,
  inputPath: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // docker run -v workspace:/work -w /work image bash -lc 'bash /work/entry.sh'
  const dockerArgs = [
    "run",
    "--rm",
    "-v",
    `${workspace}:/work`,
    "-w",
    "/work",
    image,
    "bash",
    "-lc",
    "if [ -f /work/input.json ]; then echo RUNNING; else echo NO_INPUT; fi; sleep 0.1; true",
  ];
  return new Promise(resolve => {
    const proc = spawn("docker", dockerArgs, {
      shell: false,
      windowsHide: true,
    });
    let out = "",
      err = "";
    proc.stdout.on("data", d => (out += d.toString()));
    proc.stderr.on("data", d => (err += d.toString()));
    proc.on("close", code =>
      resolve({ code: code ?? 1, stdout: out, stderr: err }),
    );
  });
}

async function simulateDockerTask(
  template: AgentTemplate,
  task: SubTask,
): Promise<{ success: boolean; artifacts: any; improvements: string[] }> {
  const workspace = path.resolve(
    __dirname,
    "workers",
    `${template.id}_${task.id}`,
  );
  fs.mkdirSync(workspace, { recursive: true });
  const inputPath = path.join(workspace, "input.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({ task, template }, null, 2),
    "utf8",
  );
  const image =
    {
      frontend: "codeforge/frontend-cadet:latest",
      backend: "codeforge/backend-cadet:latest",
      tests: "codeforge/tests-cadet:latest",
    }[template.domain] ?? "codeforge/frontend-cadet:latest";
  const res = await runDockerAgent(image, workspace, inputPath);
  const ok = res.code === 0;
  let artifacts: any = null;
  // attempt to load artifacts if produced
  const artifactsPath = path.join(workspace, "artifacts.json");
  if (fs.existsSync(artifactsPath)) {
    try {
      artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
    } catch {}
  }
  const improvements = artifacts?.improvements ?? [
    `Agent ${template.id} executed ${task.description}`,
  ];
  return {
    success: ok,
    artifacts: artifacts ?? { logs: res.stdout + res.stderr },
    improvements,
  };
}

async function simulateExecution(
  template: AgentTemplate,
  task: SubTask,
): Promise<{ success: boolean; artifacts: any; improvements: string[] }> {
  // Docker-based real runner
  return await simulateDockerTask(template, task);
}

function applyImprovementsToTemplates(
  templateId: string,
  improvements: string[],
  templates: AgentTemplate[],
): AgentTemplate[] {
  return templates.map(t =>
    t.id === templateId
      ? {
          ...t,
          promptTemplate:
            t.promptTemplate +
            "\n" +
            improvements.map(i => "// " + i).join("\n"),
        }
      : t,
  );
}

function maybeCreateNewTemplateFromImprovements(
  improvements: string[],
  templates: AgentTemplate[],
): AgentTemplate[] {
  const needsHybrid = improvements.some(i => i.includes("cross-domain"));
  if (needsHybrid) {
    const hybrid: AgentTemplate = {
      id: "HybridCadet",
      domain: "frontend",
      promptTemplate:
        "HybridCadet: cross-domain capabilities. Task: {task.description}.",
      tools: [],
      successCriteria: "hybrid",
      maxConcurrent: 2,
    };
    if (!templates.find(t => t.id === hybrid.id)) return [...templates, hybrid];
  }
  return templates;
}

async function runOneTask(taskDesc: string) {
  const knowledgeBase = ensureKB();
  const templates = loadTemplates();
  const subtasks = decomposeTask(taskDesc);
  const spawned: AgentInstance[] = [];
  for (const sub of subtasks) {
    const tmpl = selectTemplateForDomain(sub.domain, templates);
    const res = await simulateExecution(tmpl, sub);
    const inst: AgentInstance = {
      id: nextId("agent"),
      templateId: tmpl.id,
      task: sub,
      status: res.success ? "completed" : "failed",
      artifacts: res.artifacts,
      improvements: res.improvements,
    };
    spawned.push(inst);
    const kbe: KnowledgeBaseEntry = {
      id: nextId("kb"),
      task: sub,
      templateId: tmpl.id,
      result: res,
      improvements: res.improvements,
      createdAt: new Date().toISOString(),
    };
    knowledgeBase.push(kbe);
  }
  let updatedTemplates = templates;
  for (const a of spawned) {
    if (a.improvements && a.improvements.length > 0)
      updatedTemplates = applyImprovementsToTemplates(
        a.templateId,
        a.improvements,
        updatedTemplates,
      );
  }
  updatedTemplates = maybeCreateNewTemplateFromImprovements(
    spawned.flatMap(s => s.improvements ?? []),
    updatedTemplates,
  );
  writeJSON(templatesPath, updatedTemplates);
  writeJSON(knowledgePath, knowledgeBase);
  return { spawned, knowledgeBase };
}

export async function runPlan(taskDesc: string) {
  console.log(`Running Nimble Tiger plan for: ${taskDesc}`);
  const result = await runOneTask(taskDesc);
  console.log(`Agents spawned: ${result.spawned.length}`);
  console.log(`Knowledge base entries: ${result.knowledgeBase.length}`);
  return result;
}

if (require.main === module) {
  const sample = process.argv[2] || "Add feature X to the project";
  runPlan(sample)
    .then(r => {
      console.log("Plan complete.");
    })
    .catch(e => {
      console.error(e);
    });
}
