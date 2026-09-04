import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../src/config.js";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlDirectory = join(here, "..", "sql");
const files = (await readdir(sqlDirectory))
  .filter((name) => /^\d+_.*\.sql$/.test(name) && name !== "002_import_core.sql")
  .sort();

const client = new Client({
  connectionString: config.DATABASE_URL,
});

await client.connect();

try {
  for (const file of files) {
    console.log(`Applying ${file}`);
    const statement = await readFile(join(sqlDirectory, file), "utf8");
    await client.query(statement);
  }
} finally {
  await client.end();
}
