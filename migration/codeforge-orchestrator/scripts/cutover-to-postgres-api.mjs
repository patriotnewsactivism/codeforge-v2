import {
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = join(root, "src");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (extname(entry.name) === ".ts") {
      files.push(path);
    }
  }

  return files;
}

const configPath = join(src, "config.ts");
let configSource = await readFile(configPath, "utf8");

if (!configSource.includes("codeforgeApiUrl")) {
  configSource = configSource
    .replace(
      /\/\*\*\s*Convex deployment URL[^*]*\*\/\s*/m,
      "/** Private CodeForge application/API URL on Railway. */\n",
    )
    .replace(
      /convexUrl:\s*requireEnv\(["']CONVEX_URL["']\),/,
      'codeforgeApiUrl: requireEnv("CODEFORGE_API_URL"),',
    )
    .replace(
      /\/\*\*\s*Shared secret for authenticating with Convex HTTP endpoints\s*\*\//,
      "/** Shared secret for authenticating with the CodeForge internal API. */",
    );

  if (!configSource.includes("codeforgeApiUrl")) {
    throw new Error(
      "Could not replace CONVEX_URL in src/config.ts; inspect the current config manually.",
    );
  }

  await writeFile(configPath, configSource, "utf8");
}

const legacyClient = join(src, "convex-client.ts");
const platformClient = join(src, "platform-client.ts");
let clientSource;

try {
  clientSource = await readFile(legacyClient, "utf8");
} catch {
  clientSource = await readFile(platformClient, "utf8");
}

clientSource = clientSource
  .replace(/Convex HTTP Client/g, "CodeForge Platform HTTP Client")
  .replace(/calls the custom HTTP endpoints on the Convex backend/g, "calls the private HTTP endpoints on the Railway CodeForge backend")
  .replace(/communication between Railway orchestrator and Convex/g, "communication between the Railway orchestrator and CodeForge")
  .replace(/class ConvexClient/g, "class PlatformClient")
  .replace(/config\.convexUrl/g, "config.codeforgeApiUrl")
  .replace(/export const convexClient = new ConvexClient\(\);/g, "export const platformClient = new PlatformClient();");

await writeFile(platformClient, clientSource, "utf8");

try {
  if (legacyClient !== platformClient) {
    await rename(legacyClient, `${legacyClient}.legacy`);
  }
} catch {
  // Already renamed.
}

for (const path of await walk(src)) {
  let source = await readFile(path, "utf8");
  const original = source;

  source = source
    .replace(/\.\/convex-client\.js/g, "./platform-client.js")
    .replace(/\bconvexClient\b/g, "platformClient");

  if (source !== original) {
    await writeFile(path, source, "utf8");
  }
}

const packagePath = join(root, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

delete packageJson.dependencies?.convex;
delete packageJson.devDependencies?.convex;

await writeFile(
  packagePath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8",
);

console.log("Orchestrator now targets CODEFORGE_API_URL instead of Convex.");
console.log("Run npm install, npm run build, and scripts/verify-postgres-cutover.mjs.");
