import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.endsWith(".legacy")) {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if ([".ts", ".js", ".mjs"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

let failed = false;

for (const path of await walk(join(root, "src"))) {
  const source = await readFile(path, "utf8");

  if (/CONVEX_URL|config\.convexUrl|from\s+["']convex["']/i.test(source)) {
    console.error(`Convex runtime reference: ${path}`);
    failed = true;
  }
}

const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);

if (packageJson.dependencies?.convex || packageJson.devDependencies?.convex) {
  console.error("Convex dependency remains in package.json");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("PASS: codeforge-orchestrator runtime is Convex-free.");
