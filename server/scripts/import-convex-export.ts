import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip, { type JSZipObject } from "jszip";
import pg from "pg";
import { config } from "../src/config.js";

const { Client } = pg;
const archivePath = process.argv[2];

if (!archivePath) {
  console.error(
    "Usage: npm run import:convex -- /path/to/convex-export.zip",
  );
  process.exit(64);
}

function tableNameFromEntry(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const filename = parts.at(-1);

  if (!filename?.endsWith(".jsonl")) {
    return null;
  }

  if (filename === "documents.jsonl" && parts.length >= 2) {
    return parts.at(-2) ?? null;
  }

  return filename.slice(0, -".jsonl".length);
}

const archive = await readFile(archivePath);
const zip = await JSZip.loadAsync(archive);
const client = new Client({
  connectionString: config.DATABASE_URL,
});

await client.connect();

let imported = 0;
const counts = new Map<string, number>();

try {
  await client.query("begin");

  for (const [path, rawEntry] of Object.entries(zip.files)) {
    const entry = rawEntry as JSZipObject;
    if (entry.dir) {
      continue;
    }

    const tableName = tableNameFromEntry(path);

    if (!tableName || tableName.startsWith("_")) {
      continue;
    }

    const contents = await entry.async("string");

    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const document = JSON.parse(line) as Record<string, unknown>;
      const convexId =
        typeof document._id === "string"
          ? document._id
          : `${tableName}:${imported + 1}`;

      const creationTime =
        typeof document._creationTime === "number"
          ? document._creationTime
          : null;

      await client.query(
        `insert into legacy_convex_documents(
           table_name,
           convex_id,
           creation_time,
           document
         )
         values($1, $2, $3, $4::jsonb)
         on conflict(table_name, convex_id)
         do update
         set creation_time = excluded.creation_time,
             document = excluded.document,
             imported_at = now()`,
        [
          tableName,
          convexId,
          creationTime,
          JSON.stringify(document),
        ],
      );

      imported += 1;
      counts.set(tableName, (counts.get(tableName) ?? 0) + 1);
    }
  }

  await client.query("commit");

  const here = dirname(fileURLToPath(import.meta.url));
  const normalizeSql = await readFile(
    join(here, "..", "sql", "002_import_core.sql"),
    "utf8",
  );

  await client.query(normalizeSql);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

console.log(`Preserved ${imported} Convex documents.`);
console.table(
  [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, count]) => ({
      table,
      count,
    })),
);
console.log(
  "Core users/projects/files/chat/collaboration/build data was normalized. All other tables remain safely available in legacy_convex_documents for subsequent ports.",
);
