import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));

async function walk(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const paths = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      paths.push(path);
    }
  }

  return paths;
}

const files = await walk(root);

for (const path of files) {
  let source = await readFile(path, "utf8");
  const original = source;

  source = source
    .replace(
      /from\s+["']convex\/react["']/g,
      'from "@/lib/backend-hooks"',
    )
    .replace(
      /from\s+["']@convex-dev\/auth\/react["']/g,
      'from "@/lib/backend-hooks"',
    )
    .replace(
      /from\s+["'][^"']*convex\/_generated\/api["']/g,
      'from "@/lib/backend-api"',
    )
    .replace(
      /from\s+["'][^"']*convex\/_generated\/dataModel["']/g,
      'from "@/lib/backend-types"',
    );

  if (source !== original) {
    await writeFile(path, source, "utf8");
    console.log(`updated ${path}`);
  }
}

console.log(
  "Core Convex React/Auth/data-model imports replaced. Run rpc-coverage.mjs, then remove Convex dependencies only after unsupported RPCs are ported.",
);
