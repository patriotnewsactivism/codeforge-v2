import pg from "pg";
import { config } from "./config.js";

const { Client, Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Returns the first row of a result, throwing if the query returned none.
 * Use for INSERT/UPDATE ... RETURNING and single-row selects.
 */
export function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  result: pg.QueryResult<T>,
): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error("Query returned no rows");
  }
  return row;
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createListener(): Promise<pg.Client> {
  const client = new Client({
    connectionString: config.DATABASE_URL,
  });

  await client.connect();
  return client;
}
