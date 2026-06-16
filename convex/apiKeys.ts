/**
 * apiKeys.ts — Per-user BYOK API key management for CodeForge
 *
 * Lifetime plan users must supply their own AI provider keys.
 * Keys are stored obfuscated (XOR + base64) — never returned in plaintext.
 * Only the last 4 chars are ever shown after save.
 *
 * Supported providers:
 *   openai    → OPENAI_API_KEY
 *   deepseek  → DEEPSEEK_API_KEY
 *   xai       → XAI_API_KEY (Grok)
 *   moonshot  → MOONSHOT_API_KEY (Kimi)
 */
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

// ─── OBFUSCATION ─────────────────────────────────────────────────────────────
// Simple XOR obfuscation — not cryptographic, but prevents plaintext storage
// in Convex dashboard. For production, swap for AES via a KMS-backed action.

const OBFUSCATION_KEY = "cf2_byok_key_2024"; // rotate periodically

function obfuscate(text: string): string {
  const key = OBFUSCATION_KEY;
  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(result, "binary").toString("base64");
}

function deobfuscate(encoded: string): string {
  const key = OBFUSCATION_KEY;
  const text = Buffer.from(encoded, "base64").toString("binary");
  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 6).replace(/./g, "*") + "..." + key.slice(-4);
}

// ─── PROVIDER VALIDATION ──────────────────────────────────────────────────────

const PROVIDER_ENDPOINTS: Record<string, { url: string; model: string }> = {
  openai:   { url: "https://api.openai.com/v1/chat/completions",  model: "gpt-4o-mini" },
  deepseek: { url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  xai:      { url: "https://api.x.ai/v1/chat/completions",         model: "grok-3-fast" },
  moonshot: { url: "https://api.moonshot.cn/v1/chat/completions",  model: "moonshot-v1-8k" },
};

async function validateKeyWithProvider(provider: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return { valid: false, error: "Unknown provider" };

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });

    // 200 or 400 (bad request but auth passed) = key is valid
    if (res.ok || res.status === 400) return { valid: true };

    if (res.status === 401) return { valid: false, error: "Invalid API key — authentication failed" };
    if (res.status === 403) return { valid: false, error: "API key lacks required permissions" };
    if (res.status === 429) return { valid: true }; // rate limited = key exists and is valid

    const body = await res.text().catch(() => "");
    return { valid: false, error: `Provider returned ${res.status}: ${body.slice(0, 100)}` };
  } catch (err) {
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

// ─── QUERIES ──────────────────────────────────────────────────────────────────

/** Returns masked key info for display — NEVER returns the actual key */
export const listMyKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const keys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return keys.map((k) => ({
      id: k._id,
      provider: k.provider,
      maskedKey: k.maskedKey,
      isValid: k.isValid,
      validatedAt: k.validatedAt,
      addedAt: k.addedAt,
    }));
  },
});

/** Returns the raw decrypted key for a specific provider — for internal AI router use only */
export const getKeyForProvider = query({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const keyRecord = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", userId).eq("provider", args.provider as "openai" | "deepseek" | "xai" | "moonshot")
      )
      .first();

    if (!keyRecord) return null;
    return deobfuscate(keyRecord.encryptedKey);
  },
});

/** Get all decrypted keys for a user — used by AI router for lifetime users */
export const getAllKeysForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const result: Record<string, string> = {};
    for (const k of keys) {
      result[k.provider] = deobfuscate(k.encryptedKey);
    }
    return result;
  },
});

/** Check if the current user has at least one valid key saved */
export const hasAnyKey = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const key = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return key !== null;
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

/** Save a key after validation. Validates first, then stores obfuscated. */
export const saveKey = action({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("deepseek"),
      v.literal("xai"),
      v.literal("moonshot")
    ),
    apiKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; maskedKey?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const trimmed = args.apiKey.trim();
    if (trimmed.length < 16) {
      return { success: false, error: "API key is too short — please check and try again" };
    }

    // Validate before storing
    const validation = await validateKeyWithProvider(args.provider, trimmed);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? "Key validation failed" };
    }

    const encryptedKey = obfuscate(trimmed);
    const maskedKey = maskKey(trimmed);

    await ctx.runMutation(api.apiKeys.upsertKey, {
      userId,
      provider: args.provider,
      encryptedKey,
      maskedKey,
      isValid: true,
      validatedAt: Date.now(),
    });

    return { success: true, maskedKey };
  },
});

/** Internal upsert used by saveKey action */
export const upsertKey = mutation({
  args: {
    userId: v.id("users"),
    provider: v.union(
      v.literal("openai"),
      v.literal("deepseek"),
      v.literal("xai"),
      v.literal("moonshot")
    ),
    encryptedKey: v.string(),
    maskedKey: v.string(),
    isValid: v.boolean(),
    validatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedKey: args.encryptedKey,
        maskedKey: args.maskedKey,
        isValid: args.isValid,
        validatedAt: args.validatedAt,
      });
    } else {
      await ctx.db.insert("userApiKeys", {
        userId: args.userId,
        provider: args.provider,
        encryptedKey: args.encryptedKey,
        maskedKey: args.maskedKey,
        isValid: args.isValid,
        validatedAt: args.validatedAt,
        addedAt: Date.now(),
      });
    }
  },
});

/** Remove a specific provider key */
export const deleteKey = mutation({
  args: {
    provider: v.union(
      v.literal("openai"),
      v.literal("deepseek"),
      v.literal("xai"),
      v.literal("moonshot")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", userId).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { success: true };
  },
});
