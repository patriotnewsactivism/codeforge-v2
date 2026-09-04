import {
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";

const packageUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

for (const dependency of [
  "convex",
  "@convex-dev/auth",
]) {
  delete packageJson.dependencies?.[dependency];
  delete packageJson.devDependencies?.[dependency];
}

await writeFile(
  packageUrl,
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8",
);

const convexUrl = new URL("../convex/", import.meta.url);
const backupUrl = new URL("../convex.legacy/", import.meta.url);

try {
  await rename(convexUrl, backupUrl);
  console.log("Moved convex/ -> convex.legacy/");
} catch {
  console.log("No convex/ directory found.");
}

console.log(
  "Convex dependencies removed from package.json. Run npm install to refresh package-lock.json, then run verify-convex-free.mjs again before deleting convex.legacy/.",
);
