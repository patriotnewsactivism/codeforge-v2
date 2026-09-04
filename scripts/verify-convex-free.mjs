import { access, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(root, "src");
const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

async function walk(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const paths = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
      continue;
    }

    if (scanExtensions.has(extname(entry.name))) {
      paths.push(path);
    }
  }

  return paths;
}

let failed = false;
const files = await walk(sourceRoot);

for (const path of files) {
  const contents = await readFile(path, "utf8");

  if (
    /from\s+["']convex\/|@convex-dev\/auth|convex\/_generated|VITE_CONVEX_URL|CONVEX_DEPLOYMENT/i.test(
      contents,
    )
  ) {
    console.error(`Production Convex reference: ${path}`);
    failed = true;
  }
}

const packagePath = join(root, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const dependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};

for (const dependency of Object.keys(dependencies)) {
  if (dependency === "convex" || dependency.startsWith("@convex-dev/")) {
    console.error(`Convex dependency remains in package.json: ${dependency}`);
    failed = true;
  }
}

try {
  await access(join(root, "convex"));
  console.warn(
    "WARN: ./convex still exists. It may be retained as legacy source until final archival, but it must not be imported by production code.",
  );
} catch {
  // No legacy directory is also valid.
}

if (failed) {
  console.error(
    "NOT READY: keep Convex active until production imports and dependencies are removed.",
  );
  process.exit(1);
}

console.log("PASS: production source and dependencies are Convex-free.");
