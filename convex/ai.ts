/**
 * ai.ts — CodeForge AI Router (BYOK update)
 *
 * CHANGES FROM ORIGINAL:
 * - getApiKey() now accepts an optional userKeys map (for lifetime users)
 * - callAI() accepts optional callerPlan + userKeys
 * - callAIWithFallback() enforces BYOK-only fallback for lifetime users
 *   (does NOT fall back to platform keys if a lifetime user's key fails)
 * - New exported helper: checkByokRequirement()
 *
 * All other code (MODELS, DEFAULT_MODEL, AGENT_MODELS, etc.) unchanged.
 */

import { api } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

// ─── MODEL REGISTRY ────────────────────────────────────────────────────────
// (unchanged from original — copy as-is)

export interface ModelConfig {
  id: string;
  name: string;
  provider:
    | "anthropic"
    | "deepseek"
    | "groq"
    | "xai"
    | "moonshot"
    | "openai"
    | "openrouter"
    | "azure";
  apiModel: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  maxTokens: number;
  tier: "strong" | "balanced" | "fast";
}

export const MODELS: Record<string, ModelConfig> = {
  // ── Anthropic Claude (latest) — wired via Anthropic's OpenAI-compatible
  //    endpoint (https://api.anthropic.com/v1/chat/completions). Requires
  //    ANTHROPIC_API_KEY; falls back to deepseek/gpt-4o-mini if unset.
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    provider: "anthropic",
    apiModel: "claude-opus-4-8",
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    apiModel: "claude-sonnet-4-6",
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    apiModel: "claude-haiku-4-5-20251001",
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "deepseek-v3": {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    provider: "deepseek",
    apiModel: "deepseek-chat",
    inputCostPer1M: 0.27,
    outputCostPer1M: 1.1,
    maxTokens: 8192,
    tier: "balanced",
  },
  "deepseek-chat": {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    apiModel: "deepseek-chat",
    inputCostPer1M: 0.27,
    outputCostPer1M: 1.1,
    maxTokens: 8192,
    tier: "balanced",
  },
  // ── Groq — ultra-fast inference, cheapest capable models.
  //    Requires GROQ_API_KEY. OpenAI-compatible endpoint.
  "groq-llama-3.3-70b": {
    id: "groq-llama-3.3-70b",
    name: "Llama 3.3 70B (Groq)",
    provider: "groq",
    apiModel: "llama-3.3-70b-versatile",
    inputCostPer1M: 0.059,
    outputCostPer1M: 0.079,
    maxTokens: 8192,
    tier: "balanced",
  },
  "groq-llama-3.1-8b": {
    id: "groq-llama-3.1-8b",
    name: "Llama 3.1 8B (Groq)",
    provider: "groq",
    apiModel: "llama-3.1-8b-instant",
    inputCostPer1M: 0.05,
    outputCostPer1M: 0.08,
    maxTokens: 8192,
    tier: "fast",
  },
  "groq-llama-4-scout": {
    id: "groq-llama-4-scout",
    name: "Llama 4 Scout (Groq)",
    provider: "groq",
    apiModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    inputCostPer1M: 0.11,
    outputCostPer1M: 0.34,
    maxTokens: 8192,
    tier: "balanced",
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "deepseek",
    apiModel: "deepseek-reasoner",
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
    maxTokens: 8192,
    tier: "strong",
  },
  "grok-3-fast": {
    id: "grok-3-fast",
    name: "Grok 3 Fast",
    provider: "xai",
    apiModel: "grok-3-fast",
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    maxTokens: 8192,
    tier: "fast",
  },
  "grok-4": {
    id: "grok-4",
    name: "Grok 4",
    provider: "xai",
    apiModel: "grok-4",
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "kimi-k2": {
    id: "kimi-k2",
    name: "Kimi K2",
    provider: "moonshot",
    apiModel: "moonshot-v1-8k",
    inputCostPer1M: 0.12,
    outputCostPer1M: 0.12,
    maxTokens: 8192,
    tier: "fast",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    apiModel: "gpt-4o-mini",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    maxTokens: 8192,
    tier: "fast",
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    apiModel: "gpt-4o",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    maxTokens: 8192,
    tier: "strong",
  },

  // ── OpenRouter — one key, dozens of cheap models (OpenAI-compatible).
  //    Ideal for spawning many agents cheaply. Requires OPENROUTER_API_KEY.
  "or-deepseek-v3": {
    id: "or-deepseek-v3",
    name: "DeepSeek V3 (OpenRouter)",
    provider: "openrouter",
    apiModel: "deepseek/deepseek-chat",
    inputCostPer1M: 0.28,
    outputCostPer1M: 1.14,
    maxTokens: 16384,
    tier: "balanced",
  },
  "or-llama-3.3-70b": {
    id: "or-llama-3.3-70b",
    name: "Llama 3.3 70B (OpenRouter)",
    provider: "openrouter",
    apiModel: "meta-llama/llama-3.3-70b-instruct",
    inputCostPer1M: 0.12,
    outputCostPer1M: 0.3,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-qwen-coder": {
    id: "or-qwen-coder",
    name: "Qwen 2.5 Coder 32B (OpenRouter)",
    provider: "openrouter",
    apiModel: "qwen/qwen-2.5-coder-32b-instruct",
    inputCostPer1M: 0.06,
    outputCostPer1M: 0.15,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-gemini-flash": {
    id: "or-gemini-flash",
    name: "Gemini 2.5 Flash (OpenRouter)",
    provider: "openrouter",
    apiModel: "google/gemini-2.5-flash",
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    maxTokens: 8192,
    tier: "fast",
  },
  // Kimi and Grok via OpenRouter — one key (OPENROUTER_API_KEY) instead of
  // separate Moonshot/xAI (or Azure) accounts.
  "or-kimi-k2": {
    id: "or-kimi-k2",
    name: "Kimi K2 (OpenRouter)",
    provider: "openrouter",
    apiModel: "moonshotai/kimi-k2",
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.14,
    maxTokens: 16384,
    tier: "fast",
  },
  "or-deepseek-reasoner": {
    id: "or-deepseek-reasoner",
    name: "DeepSeek R1 (OpenRouter)",
    provider: "openrouter",
    apiModel: "deepseek/deepseek-r1",
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
    maxTokens: 16384,
    tier: "strong",
  },
  "or-grok-4": {
    id: "or-grok-4",
    name: "Grok 4 (OpenRouter)",
    provider: "openrouter",
    apiModel: "x-ai/grok-4",
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "or-grok-3": {
    id: "or-grok-3",
    name: "Grok 4 Fast (OpenRouter)",
    provider: "openrouter",
    apiModel: "x-ai/grok-4-fast",
    inputCostPer1M: 0.2,
    outputCostPer1M: 0.5,
    maxTokens: 16384,
    tier: "fast",
  },
  "or-claude-sonnet": {
    id: "or-claude-sonnet",
    name: "Claude Opus 4.8 (OpenRouter)",
    provider: "openrouter",
    apiModel: "anthropic/claude-opus-4.8",
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "or-claude-haiku": {
    id: "or-claude-haiku",
    name: "Claude Haiku 4.5 (OpenRouter)",
    provider: "openrouter",
    apiModel: "anthropic/claude-haiku-4.5",
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-gpt-4o-mini": {
    id: "or-gpt-4o-mini",
    name: "GPT-4o Mini (OpenRouter)",
    provider: "openrouter",
    apiModel: "openai/gpt-4o-mini",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    maxTokens: 8192,
    tier: "fast",
  },
  "or-gpt-4o": {
    id: "or-gpt-4o",
    name: "GPT-4o (OpenRouter)",
    provider: "openrouter",
    apiModel: "openai/gpt-4o",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    maxTokens: 8192,
    tier: "strong",
  },
  "or-o3-mini": {
    id: "or-o3-mini",
    name: "o4-mini (OpenRouter)",
    provider: "openrouter",
    apiModel: "openai/o4-mini",
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
    maxTokens: 8192,
    tier: "strong",
  },
  "or-gpt-4-5": {
    id: "or-gpt-4-5",
    name: "GPT-4.1 Mini (OpenRouter)",
    provider: "openrouter",
    apiModel: "openai/gpt-4.1-mini",
    inputCostPer1M: 0.4,
    outputCostPer1M: 1.6,
    maxTokens: 16384,
    tier: "balanced",
  },
  "or-llama-4-maverick": {
    id: "or-llama-4-maverick",
    name: "Llama 4 Maverick (OpenRouter)",
    provider: "openrouter",
    apiModel: "meta-llama/llama-4-maverick",
    inputCostPer1M: 0.2,
    outputCostPer1M: 0.6,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-qwen-3-235b": {
    id: "or-qwen-3-235b",
    name: "Qwen 3 235B (OpenRouter)",
    provider: "openrouter",
    apiModel: "qwen/qwen-3-235b",
    inputCostPer1M: 0.2,
    outputCostPer1M: 0.6,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-codestral": {
    id: "or-codestral",
    name: "Codestral (OpenRouter)",
    provider: "openrouter",
    apiModel: "mistralai/codestral",
    inputCostPer1M: 0.3,
    outputCostPer1M: 0.9,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-hermes-3-405b": {
    id: "or-hermes-3-405b",
    name: "Hermes 3 405B (OpenRouter)",
    provider: "openrouter",
    apiModel: "nousresearch/hermes-3-llama-3.1-405b",
    inputCostPer1M: 0.8,
    outputCostPer1M: 0.8,
    maxTokens: 8192,
    tier: "strong",
  },
  "or-gemini-pro": {
    id: "or-gemini-pro",
    name: "Gemini 2.5 Pro (OpenRouter)",
    provider: "openrouter",
    apiModel: "google/gemini-2.5-pro",
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    maxTokens: 16384,
    tier: "strong",
  },
};

export const DEFAULT_MODEL = "groq-llama-3.3-70b";

// Agents are spawned in large numbers, so the defaults are deliberately the
// cheapest-yet-capable models: DeepSeek for reasoning/coding and Kimi K2 for
// high-volume utility roles. Premium models (Claude, Grok 4, GPT-4o) remain
// selectable per-call or per-user but are never the swarm default.
//   deepseek-reasoner  $0.55 / $2.19   — strong reasoning, very cheap
//   deepseek-v3        $0.27 / $1.10   — excellent coder, very cheap
//   kimi-k2            $0.12 / $0.12    — cheapest, fine for utility work
// Routed entirely through OpenRouter so the swarm needs only one key
// (OPENROUTER_API_KEY) — no separate DeepSeek / Moonshot / xAI / Azure
// accounts required.
export const AGENT_MODELS: Record<string, string> = {
  orchestrator: "deepseek-v3",
  architect: "deepseek-v3",
  coder: "groq-llama-3.3-70b",
  reviewer: "groq-llama-3.3-70b",
  debugger: "deepseek-v3",
  tester: "groq-llama-3.3-70b",
  devops: "groq-llama-3.3-70b",
  sentry: "groq-llama-3.3-70b",
  forensic: "deepseek-v3",
  reflection: "deepseek-v3",
  strategist: "deepseek-v3",
  default: "groq-llama-3.3-70b",
};

// ─── PROVIDER BASE URLS ────────────────────────────────────────────────────

function getBaseUrl(provider: ModelConfig["provider"]): string {
  switch (provider) {
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "moonshot":
      return "https://api.moonshot.cn/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "azure":
      return process.env.AZURE_OPENAI_ENDPOINT ?? "";
  }
}

// Provider → userApiKeys field mapping
const PROVIDER_KEY_MAP: Record<ModelConfig["provider"], string> = {
  anthropic: "anthropic",
  deepseek: "deepseek",
  groq: "groq",
  xai: "xai",
  moonshot: "moonshot",
  openai: "openai",
  openrouter: "openrouter",
  azure: "openai",
};

/**
 * getApiKey — resolves the API key for a provider.
 *
 * For lifetime users: reads from their supplied userKeys map.
 * For weekly/monthly/free: reads from process.env (platform keys).
 *
 * @param provider    - the AI provider
 * @param callerPlan  - "lifetime" | "monthly" | "weekly" | "free"
 * @param userKeys    - map of provider → decrypted key (for lifetime users)
 */
function getApiKey(
  provider: ModelConfig["provider"],
  callerPlan?: string,
  userKeys?: Record<string, string>,
): string {
  if (callerPlan === "lifetime" && userKeys) {
    const providerSlug = PROVIDER_KEY_MAP[provider];
    const userKey = userKeys[providerSlug];
    if (userKey) return userKey;
    // No user key for this provider — return empty so the caller can handle it
    return "";
  }

  // Platform keys for weekly/monthly/free
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? "";
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY ?? "";
    case "xai":
      return process.env.XAI_API_KEY ?? "";
    case "moonshot":
      return process.env.MOONSHOT_API_KEY ?? "";
    case "openai":
      return process.env.OPENAI_API_KEY ?? "";
    case "groq":
      return process.env.GROQ_API_KEY ?? "";
    case "openrouter":
      return process.env.OPENROUTER_API_KEY ?? "";
    case "azure":
      return process.env.AZURE_OPENAI_API_KEY ?? "";
  }
}

// ─── COST ESTIMATION ──────────────────────────────────────────────────────

export function estimateCost(
  text: string,
  modelId: string,
  isOutput: boolean,
): { tokens: number; cost: number } {
  const tokens = Math.ceil(text.length / 4);
  const config = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];
  const costPer1M = isOutput ? config.outputCostPer1M : config.inputCostPer1M;
  return { tokens, cost: (tokens / 1_000_000) * costPer1M };
}

// ─── BYOK REQUIREMENT CHECK ────────────────────────────────────────────────

/**
 * checkByokRequirement — determines if a lifetime user is blocked from AI use.
 *
 * Returns { blocked: false } if the user can proceed.
 * Returns { blocked: true, message } if they need to add keys first.
 */
export function checkByokRequirement(
  callerPlan: string,
  userKeys?: Record<string, string>,
): { blocked: boolean; message?: string } {
  if (callerPlan !== "lifetime") return { blocked: false };

  const hasAtLeastOneKey = userKeys && Object.keys(userKeys).length > 0;
  if (!hasAtLeastOneKey) {
    return {
      blocked: true,
      message:
        "Lifetime plan requires your own API key — add one in Settings → API Keys.",
    };
  }
  return { blocked: false };
}

// ─── TYPES ────────────────────────────────────────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICallOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** The calling user's plan key — determines platform vs BYOK keys */
  callerPlan?: string;
  /** Decrypted user-supplied API keys — required when callerPlan === "lifetime" */
  userKeys?: Record<string, string>;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIResponse {
  text: string;
  usage?: AIUsage;
}

// ─── CORE AI CALL ─────────────────────────────────────────────────────────

/**
 * callAI — single entry point for all AI calls.
 *
 * For lifetime users: inject their own API keys.
 * For others: use platform environment keys.
 */
export async function callAI(
  promptOrMessages: string | Message[],
  options: AICallOptions = {},
): Promise<AIResponse> {
  const modelId = options.model ?? DEFAULT_MODEL;
  const config = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  // BYOK gate
  const byokCheck = checkByokRequirement(
    options.callerPlan ?? "free",
    options.userKeys,
  );
  if (byokCheck.blocked) {
    throw new Error(byokCheck.message!);
  }

  const messages: Message[] =
    typeof promptOrMessages === "string"
      ? [
          ...(options.systemPrompt
            ? [{ role: "system" as const, content: options.systemPrompt }]
            : []),
          { role: "user" as const, content: promptOrMessages },
        ]
      : promptOrMessages;

  const baseUrl = getBaseUrl(config.provider);
  const apiKey = getApiKey(
    config.provider,
    options.callerPlan,
    options.userKeys,
  );

  if (!apiKey) {
    if (options.callerPlan === "lifetime") {
      throw new Error(
        `No ${config.name} API key configured. Add your ${config.provider.toUpperCase()} key in Settings → API Keys.`,
      );
    }
    throw new Error(
      `No API key configured for provider "${config.provider}". ` +
        `Set ${config.provider.toUpperCase()}_API_KEY in your Convex environment.`,
    );
  }

  // OpenRouter recommends app-identifying headers for attribution and to
  // avoid request deprioritization. Harmless for other providers, but only
  // sent for OpenRouter.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.SITE_URL ?? "https://code.donmatthews.live";
    headers["X-Title"] = "CodeForge";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.apiModel,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? config.maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${config.name} API error ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    error?: { message?: string };
  };

  if (json.error) throw new Error(`${config.name}: ${json.error.message}`);

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${config.name} returned empty response`);

  return {
    text: content,
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * callAIWithFallback — tries the requested model, then falls back.
 *
 * BYOK users (lifetime): fallback only cycles through THEIR available keys.
 *   If primary model fails and they have no key for the fallback provider,
 *   that fallback is skipped. If ALL fail, surfaces the error — does NOT
 *   fall back to platform keys.
 *
 * Platform users (weekly/monthly/free): standard fallback chain using platform keys.
 */
export async function callAIWithFallback(
  promptOrMessages: string | Message[],
  options: AICallOptions = {},
): Promise<AIResponse & { modelUsed: string }> {
  const requested = options.model ?? DEFAULT_MODEL;
  const isLifetime = options.callerPlan === "lifetime";

  // Build fallback chain. Defaults stay on OpenRouter so a single
  // OPENROUTER_API_KEY can serve the whole chain.
  const fullChain = [requested, "groq-llama-3.3-70b", "deepseek-v3"].filter(
    (m, i, arr) => arr.indexOf(m) === i && MODELS[m],
  );

  // For lifetime users: filter chain to only models their keys can serve
  const chain =
    isLifetime && options.userKeys
      ? fullChain.filter(modelId => {
          const providerSlug = PROVIDER_KEY_MAP[MODELS[modelId].provider];
          return !!options.userKeys![providerSlug];
        })
      : fullChain;

  if (isLifetime && chain.length === 0) {
    throw new Error(
      "No API keys configured for any supported model. " +
        "Add at least one key in Settings → API Keys to use AI features.",
    );
  }

  const errors: string[] = [];

  for (const modelId of chain) {
    try {
      const response = await callAI(promptOrMessages, {
        ...options,
        model: modelId,
      });
      return { ...response, modelUsed: modelId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${msg}`);

      // For lifetime users: don't swallow auth errors — surface immediately
      if (
        isLifetime &&
        (msg.includes("401") || msg.includes("Invalid API key"))
      ) {
        throw new Error(
          `Your ${MODELS[modelId].name} API key is invalid. ` +
            `Please update it in Settings → API Keys.\n\nError: ${msg}`,
        );
      }
    }
  }

  throw new Error(`All models failed:\n${errors.join("\n")}`);
}

export const MODEL_PROFILES: Record<string, Record<string, string>> = {
  // Default: DeepSeek V3 for planning/reasoning, Groq Llama for fast execution
  viktor: {
    orchestrator: "deepseek-v3",
    architect: "deepseek-v3",
    coder: "groq-llama-3.3-70b",
    reviewer: "groq-llama-3.3-70b",
    debugger: "deepseek-v3",
    tester: "groq-llama-3.3-70b",
    devops: "groq-llama-3.3-70b",
    sentry: "groq-llama-3.3-70b",
    forensic: "deepseek-v3",
    reflection: "deepseek-v3",
    strategist: "deepseek-v3",
    default: "groq-llama-3.3-70b",
  },
  // Budget: all Groq (~$0.06/M)
  budget: {
    orchestrator: "groq-llama-3.3-70b",
    architect: "groq-llama-3.3-70b",
    coder: "groq-llama-3.3-70b",
    reviewer: "groq-llama-3.1-8b",
    debugger: "groq-llama-3.3-70b",
    tester: "groq-llama-3.1-8b",
    devops: "groq-llama-3.1-8b",
    sentry: "groq-llama-3.1-8b",
    forensic: "groq-llama-3.3-70b",
    reflection: "groq-llama-3.3-70b",
    strategist: "groq-llama-3.3-70b",
    default: "groq-llama-3.3-70b",
  },
  // Premium: Anthropic Claude for everything
  premium: {
    orchestrator: "claude-opus-4-8",
    architect: "claude-opus-4-8",
    coder: "claude-sonnet-4-6",
    reviewer: "claude-opus-4-8",
    debugger: "claude-sonnet-4-6",
    tester: "claude-haiku-4-5",
    devops: "claude-haiku-4-5",
    sentry: "claude-haiku-4-5",
    forensic: "claude-opus-4-8",
    reflection: "claude-opus-4-8",
    strategist: "claude-opus-4-8",
    default: "claude-sonnet-4-6",
  },
  // Reasoning: DeepSeek R1 for deep analysis, Groq for fast tasks
  reasoning: {
    orchestrator: "deepseek-reasoner",
    architect: "deepseek-reasoner",
    coder: "deepseek-v3",
    reviewer: "groq-llama-3.3-70b",
    debugger: "deepseek-reasoner",
    tester: "groq-llama-3.3-70b",
    devops: "groq-llama-3.3-70b",
    sentry: "groq-llama-3.3-70b",
    forensic: "deepseek-reasoner",
    reflection: "deepseek-reasoner",
    strategist: "deepseek-reasoner",
    default: "deepseek-v3",
  },
  // Speed: all Groq Llama 3.1 8B — fastest possible, lowest cost
  speed: {
    orchestrator: "groq-llama-3.3-70b",
    architect: "groq-llama-3.3-70b",
    coder: "groq-llama-3.1-8b",
    reviewer: "groq-llama-3.1-8b",
    debugger: "groq-llama-3.3-70b",
    tester: "groq-llama-3.1-8b",
    devops: "groq-llama-3.1-8b",
    sentry: "groq-llama-3.1-8b",
    forensic: "groq-llama-3.3-70b",
    reflection: "groq-llama-3.3-70b",
    strategist: "groq-llama-3.3-70b",
    default: "groq-llama-3.1-8b",
  },
};

/**
 * getModelForRole — returns the best model ID for a given agent role.
 */
export async function getModelForRole(ctx: any, role: string): Promise<string> {
  let profile = "viktor";
  try {
    profile = await ctx.runQuery(api.users.getAiProfileInternal, {});
  } catch (_err) {
    // Fall back to default profile if query fails or auth issues
  }
  const profileMap = MODEL_PROFILES[profile] ?? MODEL_PROFILES.viktor;
  return (
    profileMap[role.toLowerCase()] ??
    profileMap.default ??
    AGENT_MODELS[role.toLowerCase()] ??
    AGENT_MODELS.default
  );
}
