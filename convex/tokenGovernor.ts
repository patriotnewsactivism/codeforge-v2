import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export interface TokenBudgetConfig {
  maxTokensPerMinute: number;
  maxTokensPerDay: number;
  costPer1kTokensUsd: number;
}

const DEFAULT_TIER_LIMITS: Record<string, TokenBudgetConfig> = {
  free: { maxTokensPerMinute: 8000, maxTokensPerDay: 50000, costPer1kTokensUsd: 0.002 },
  pro: { maxTokensPerMinute: 60000, maxTokensPerDay: 500000, costPer1kTokensUsd: 0.0015 },
  lifetime: { maxTokensPerMinute: 120000, maxTokensPerDay: 2000000, costPer1kTokensUsd: 0 },
};

export const checkTokenBudget = query({
  args: {
    tier: v.optional(v.string()),
    requestedTokens: v.number(),
    recentMinuteTokens: v.number(),
    todayTokens: v.number(),
  },
  handler: async (_ctx, args) => {
    const config = DEFAULT_TIER_LIMITS[args.tier ?? "free"] ?? DEFAULT_TIER_LIMITS.free;
    
    const minuteAllowed = (args.recentMinuteTokens + args.requestedTokens) <= config.maxTokensPerMinute;
    const dayAllowed = (args.todayTokens + args.requestedTokens) <= config.maxTokensPerDay;
    const allowed = minuteAllowed && dayAllowed;

    let reason: string | undefined;
    if (!minuteAllowed) {
      reason = `Rate limit exceeded: ${args.recentMinuteTokens + args.requestedTokens}/${config.maxTokensPerMinute} tokens/min`;
    } else if (!dayAllowed) {
      reason = `Daily token quota exceeded: ${args.todayTokens + args.requestedTokens}/${config.maxTokensPerDay} tokens/day`;
    }

    return {
      allowed,
      reason,
      estimatedCostUsd: (args.requestedTokens / 1000) * config.costPer1kTokensUsd,
      maxTokensPerMinute: config.maxTokensPerMinute,
      maxTokensPerDay: config.maxTokensPerDay,
    };
  },
});

export const verifyByokKey = mutation({
  args: {
    provider: v.string(),
    apiKeyMasked: v.string(),
    encryptedKeyHex: v.string(),
    keyChecksum: v.string(),
  },
  handler: async (_ctx, args) => {
    // Validate basic structure and non-empty cipher format
    if (!args.encryptedKeyHex || args.encryptedKeyHex.length < 16) {
      return { valid: false, error: "Encrypted payload too short or invalid." };
    }

    if (!args.keyChecksum || args.keyChecksum.length !== 64) {
      return { valid: false, error: "Invalid SHA-256 key checksum." };
    }

    const validPrefixes: Record<string, string> = {
      openai: "sk-",
      deepseek: "sk-",
      anthropic: "sk-ant-",
      xai: "xai-",
      gemini: "AIzaSy",
    };

    const expectedPrefix = validPrefixes[args.provider.toLowerCase()];
    if (expectedPrefix && !args.apiKeyMasked.startsWith(expectedPrefix.slice(0, 3))) {
      return {
        valid: false,
        error: `Key format does not match typical prefix for ${args.provider}`,
      };
    }

    return {
      valid: true,
      provider: args.provider,
      verifiedAt: Date.now(),
    };
  },
});
