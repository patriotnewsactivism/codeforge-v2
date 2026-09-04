import argon2 from "argon2";
import pg from "pg";
import { config } from "../src/config.js";

const { Client } = pg;
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password || password.length < 8) {
  console.error(
    "Usage: npm run set-password -- user@example.com 'new-password'",
  );
  process.exit(64);
}

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
});

const client = new Client({
  connectionString: config.DATABASE_URL,
});

await client.connect();

try {
  const result = await client.query(
    `update users
     set password_hash = $1,
         password_reset_required = false,
         updated_at = now()
     where lower(email) = lower($2)
     returning id, email`,
    [passwordHash, email],
  );

  if (result.rowCount !== 1) {
    throw new Error(`No user found for ${email}`);
  }

  await client.query(
    `update refresh_tokens
     set revoked_at = now()
     where user_id = $1
       and revoked_at is null`,
    [result.rows[0].id],
  );

  console.log(`Password updated for ${result.rows[0].email}`);
} finally {
  await client.end();
}
