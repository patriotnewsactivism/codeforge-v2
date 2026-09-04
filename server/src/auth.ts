import { createHash, randomBytes, randomInt } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
import { one, sql, withTransaction } from "./db.js";

const jwtKey = new TextEncoder().encode(config.JWT_SECRET);
const refreshCookieName = "codeforge_refresh";

export interface AuthUser {
  id: string;
  name: string | null;
  image: string | null;
  email: string | null;
  onboarded: boolean;
  plan: string | null;
  subscriptionStatus: string | null;
  aiProfile: string | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
    public readonly code = "AUTH_ERROR",
  ) {
    super(message);
  }
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function userShape(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    name: row.name == null ? null : String(row.name),
    image: row.image == null ? null : String(row.image),
    email: row.email == null ? null : String(row.email),
    onboarded: Boolean(row.onboarded),
    plan: row.plan == null ? null : String(row.plan),
    subscriptionStatus:
      row.subscription_status == null
        ? null
        : String(row.subscription_status),
    aiProfile:
      row.ai_profile == null ? null : String(row.ai_profile),
  };
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({
    typ: "access",
  })
    .setProtectedHeader({
      alg: "HS256",
    })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_MINUTES}m`)
    .sign(jwtKey);
}

async function issueRefreshToken(
  userId: string,
  reply: FastifyReply,
): Promise<void> {
  const raw = randomBytes(48).toString("base64url");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(
    Date.now() + config.REFRESH_TOKEN_DAYS * 86_400_000,
  );

  await sql(
    `insert into refresh_tokens(user_id, token_hash, expires_at)
     values($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  reply.setCookie(refreshCookieName, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    path: "/api/auth",
    expires: expiresAt,
  });
}

export async function issueSession(
  user: AuthUser,
  reply: FastifyReply,
): Promise<{ accessToken: string; user: AuthUser }> {
  await issueRefreshToken(user.id, reply);
  return {
    accessToken: await signAccessToken(user.id),
    user,
  };
}

export async function register(
  input: {
    name: string;
    email: string;
    password: string;
  },
  reply: FastifyReply,
): Promise<{ accessToken: string; user: AuthUser }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });

  try {
    const result = await sql(
      `insert into users(
         name,
         email,
         password_hash,
         password_reset_required,
         onboarded
       )
       values($1, $2, $3, false, false)
       returning *`,
      [input.name.trim(), normalizedEmail, passwordHash],
    );

    return issueSession(userShape(one(result)), reply);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AuthError(
        "An account with this email already exists",
        409,
        "EMAIL_EXISTS",
      );
    }

    throw error;
  }
}

export async function login(
  email: string,
  password: string,
  reply: FastifyReply,
): Promise<{ accessToken: string; user: AuthUser }> {
  const result = await sql(
    `select *
     from users
     where lower(email) = lower($1)
     limit 1`,
    [email.trim()],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;

  if (!row) {
    throw new AuthError("Invalid email or password");
  }

  if (!row.password_hash || row.password_reset_required) {
    throw new AuthError(
      "Password reset required for this migrated account",
      403,
      "PASSWORD_RESET_REQUIRED",
    );
  }

  if (!(await argon2.verify(String(row.password_hash), password))) {
    throw new AuthError("Invalid email or password");
  }

  return issueSession(userShape(row), reply);
}

export async function refreshSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ accessToken: string; user: AuthUser }> {
  const raw = request.cookies[refreshCookieName];

  if (!raw) {
    throw new AuthError("Refresh session is missing");
  }

  const tokenHash = hashToken(raw);

  return withTransaction(async (client) => {
    const result = await client.query(
      `select rt.id as refresh_id, u.*
       from refresh_tokens rt
       join users u on u.id = rt.user_id
       where rt.token_hash = $1
         and rt.revoked_at is null
         and rt.expires_at > now()
       for update`,
      [tokenHash],
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      throw new AuthError("Refresh session is invalid or expired");
    }

    await client.query(
      `update refresh_tokens
       set revoked_at = now()
       where id = $1`,
      [row.refresh_id],
    );

    const user = userShape(row);
    const accessToken = await signAccessToken(user.id);

    const nextRaw = randomBytes(48).toString("base64url");
    const nextHash = hashToken(nextRaw);
    const expiresAt = new Date(
      Date.now() + config.REFRESH_TOKEN_DAYS * 86_400_000,
    );

    await client.query(
      `insert into refresh_tokens(user_id, token_hash, expires_at)
       values($1, $2, $3)`,
      [user.id, nextHash, expiresAt],
    );

    reply.setCookie(refreshCookieName, nextRaw, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      path: "/api/auth",
      expires: expiresAt,
    });

    return {
      accessToken,
      user,
    };
  });
}

export async function logout(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = request.cookies[refreshCookieName];

  if (raw) {
    await sql(
      `update refresh_tokens
       set revoked_at = now()
       where token_hash = $1
         and revoked_at is null`,
      [hashToken(raw)],
    );
  }

  reply.clearCookie(refreshCookieName, {
    path: "/api/auth",
  });
}

export async function requireUser(
  request: FastifyRequest,
): Promise<AuthUser> {
  const authorization = request.headers.authorization ?? "";
  const [scheme, token] = authorization.split(" ", 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError("Missing access token");
  }

  let subject: string | undefined;

  try {
    const verified = await jwtVerify(token, jwtKey);
    subject = verified.payload.sub;
  } catch {
    throw new AuthError("Access token is invalid or expired");
  }

  if (!subject) {
    throw new AuthError("Access token has no subject");
  }

  const result = await sql(
    `select *
     from users
     where id = $1`,
    [subject],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;

  if (!row) {
    throw new AuthError("User no longer exists");
  }

  return userShape(row);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const result = await sql(
    `select id, email
     from users
     where lower(email) = lower($1)
     limit 1`,
    [email.trim()],
  );

  if (result.rowCount === 0) {
    return;
  }

  if (!config.RESEND_API_KEY) {
    throw new AuthError(
      "Password-reset email is not configured",
      503,
      "EMAIL_NOT_CONFIGURED",
    );
  }

  const user = one(result);
  const code = String(randomInt(100000, 1000000));
  const codeHash = hashToken(code);

  await sql(
    `insert into password_reset_codes(user_id, code_hash, expires_at)
     values($1, $2, now() + interval '15 minutes')`,
    [user.id, codeHash],
  );

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.AUTH_FROM_EMAIL,
      to: [user.email],
      subject: "Your CodeForge password reset code",
      text: `Your CodeForge password reset code is ${code}. It expires in 15 minutes.`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new AuthError(
      "Password-reset email could not be sent",
      502,
      "EMAIL_SEND_FAILED",
    );
  }
}

export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const codeHash = hashToken(input.code.replace(/\s/g, ""));

  const outcome = await withTransaction(async (client) => {
    const result = await client.query(
      `select prc.id, prc.user_id, prc.code_hash
       from password_reset_codes prc
       join users u on u.id = prc.user_id
       where lower(u.email) = lower($1)
         and prc.used_at is null
         and prc.expires_at > now()
         and prc.attempts < 8
       order by prc.created_at desc
       limit 1
       for update of prc`,
      [input.email.trim()],
    );

    const row = result.rows[0];

    if (!row) {
      return "invalid" as const;
    }

    if (String(row.code_hash) !== codeHash) {
      await client.query(
        `update password_reset_codes
         set attempts = attempts + 1
         where id = $1`,
        [row.id],
      );
      return "invalid" as const;
    }

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });

    await client.query(
      `update users
       set password_hash = $1,
           password_reset_required = false,
           updated_at = now()
       where id = $2`,
      [passwordHash, row.user_id],
    );

    await client.query(
      `update password_reset_codes
       set used_at = now()
       where id = $1`,
      [row.id],
    );

    await client.query(
      `update refresh_tokens
       set revoked_at = now()
       where user_id = $1
         and revoked_at is null`,
      [row.user_id],
    );

    return "reset" as const;
  });

  if (outcome !== "reset") {
    throw new AuthError(
      "Reset code is invalid or expired",
      400,
      "RESET_CODE_INVALID",
    );
  }
}
