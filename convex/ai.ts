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
    | "cerebras"
    | "google"
    | "xai"
    | "moonshot"
    | "openai"
    | "openrouter"
    | "azure"
    | "kilocode"
    | "mistral"
    | "github"
    | "qwen";
  apiModel: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  maxTokens: number;
  /** Optional — for providers with a small combined TPM cap, the safe input
   *  token budget to truncate prompts to before calling (see callAI()). */
  maxSafeInputTokens?: number;
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
    // NOTE: Groq's free tier caps this specific model at 6000 tokens/minute
    // TOTAL (input + output combined) — 8192 output alone used to blow past
    // that on every call regardless of prompt size, guaranteeing a 413.
    maxTokens: 1536,
    // Leaves ~4000 tokens of headroom under the 6000 TPM cap for the
    // 1536 reserved for output. See maxSafeInputTokens truncation in callAI().
    maxSafeInputTokens: 4000,
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
  // gpt-oss-120b — OpenAI's open-weight 120B on Groq. Very capable coder /
  // diagnostician, near-instant, and cheap. Strong default for planning,
  // debugging, and code generation.
  "groq-gpt-oss-120b": {
    id: "groq-gpt-oss-120b",
    name: "GPT-OSS 120B (Groq)",
    provider: "groq",
    apiModel: "openai/gpt-oss-120b",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.75,
    maxTokens: 16384,
    tier: "strong",
  },
  // gpt-oss-20b — smaller sibling; fast + cheap for utility roles.
  "groq-gpt-oss-20b": {
    id: "groq-gpt-oss-20b",
    name: "GPT-OSS 20B (Groq)",
    provider: "groq",
    apiModel: "openai/gpt-oss-20b",
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.5,
    maxTokens: 8192,
    tier: "fast",
  },
  // Qwen3 32B — hybrid reasoning model, excellent for diagnostics / debugging
  // (emits <think> reasoning). 131k context.
  "groq-qwen3-32b": {
    id: "groq-qwen3-32b",
    name: "Qwen3 32B (Groq)",
    provider: "groq",
    apiModel: "qwen/qwen3-32b",
    inputCostPer1M: 0.29,
    outputCostPer1M: 0.59,
    maxTokens: 16384,
    tier: "balanced",
  },
  // ── Cerebras — free tier (~1M tokens/day), wafer-scale inference (fastest
  //    available). Requires CEREBRAS_API_KEY (free at cloud.cerebras.ai).
  //    GLM 4.7 is a strong open coding model — the standout free coding agent.
  "cerebras-glm-4.7": {
    id: "cerebras-glm-4.7",
    name: "GLM 4.7 (Cerebras)",
    provider: "cerebras",
    apiModel: "zai-glm-4.7",
    inputCostPer1M: 0.0,
    outputCostPer1M: 0.0,
    maxTokens: 16384,
    tier: "strong",
  },
  "cerebras-gpt-oss-120b": {
    id: "cerebras-gpt-oss-120b",
    name: "GPT-OSS 120B (Cerebras)",
    provider: "cerebras",
    apiModel: "gpt-oss-120b",
    inputCostPer1M: 0.0,
    outputCostPer1M: 0.0,
    maxTokens: 16384,
    tier: "strong",
  },
  // ── Google Gemini — generous free tier via AI Studio. Capable coder /
  //    diagnostician with very large context. Uses the existing GEMINI_API_KEY
  //    through Google's OpenAI-compatible endpoint.
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    apiModel: "gemini-2.5-flash",
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    maxTokens: 16384,
    tier: "strong",
  },
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    apiModel: "gemini-2.0-flash",
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
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
  // ── FREE-TIER models (no OpenRouter balance required — OpenRouter's own
  //    ":free" endpoints, rate-limited by OpenRouter itself, not billed).
  //    Used as the primary fallback chain so the app keeps working even
  //    with $0 OpenRouter/Cerebras/DeepSeek balance.
  "or-deepseek-v3-free": {
    id: "or-deepseek-v3-free",
    name: "Nemotron 3 Super 120B (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "nvidia/nemotron-3-super-120b-a12b:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-llama-3.3-70b-free": {
    id: "or-llama-3.3-70b-free",
    name: "Llama 3.3 70B (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "meta-llama/llama-3.3-70b-instruct:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "or-qwen3-coder-free": {
    id: "or-qwen3-coder-free",
    name: "Qwen3 Coder (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "qwen/qwen3-coder:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  // NOTE: kept id "or-devstral-free" for wiring simplicity, but OpenRouter
  // has no free Devstral/Mistral coding-agent tier right now (checked live
  // 2026-07-19) -- substituted Cohere's free code-focused model instead.
  // For a TRUE Mistral coding agent (Codestral), Don needs to add a native
  // "mistral" provider + MISTRAL_API_KEY (La Plateforme has a free tier) --
  // not yet wired here, flagging as a follow-up.
  "or-devstral-free": {
    id: "or-devstral-free",
    name: "North Mini Code (Cohere, OpenRouter Free)",
    provider: "openrouter",
    apiModel: "cohere/north-mini-code:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  // Poolside Laguna — free coding-focused model via OpenRouter.
  "or-poolside-free": {
    id: "or-poolside-free",
    name: "Poolside Laguna (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "poolside/laguna-m.1:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
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

  "or-mistral-small-24b": {
    id: "or-mistral-small-24b",
    name: "Mistral Small 24B (OpenRouter)",
    provider: "openrouter",
    apiModel: "mistralai/mistral-small-24b-instruct-2501:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
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
  "or-poolside": {
    id: "or-poolside",
    name: "Poolside (OpenRouter)",
    provider: "openrouter",
    apiModel: "poolside/poolside-ai",
    inputCostPer1M: 0.0,
    outputCostPer1M: 0.0,
    maxTokens: 8192,
    tier: "strong",
  },
  // ── Kilo Code Gateway — separate free-tier account/quota, proxies the same
  //    OpenRouter model catalog through its own rate limits (kilocode.ai).
  //    Requires KILOCODE_API_KEY. Adding this as its own provider gives the
  //    fallback chain an entirely separate quota bucket from OpenRouter
  //    itself, so if OpenRouter's free tier is rate-limited, Kilo Code's
  //    free tier is very likely still fresh.
  // Real Mistral La Plateforme -- Codestral is Mistral's dedicated coding
  // agent model. La Plateforme has a free tier (~1B tokens/month). Requires
  // MISTRAL_API_KEY. This is the genuine "mistral coding agent model" --
  // "or-devstral-free" elsewhere is a substitute (Cohere) since OpenRouter
  // has no free Devstral/Mistral tier.
  "mistral-codestral": {
    id: "mistral-codestral",
    name: "Codestral (Mistral)",
    provider: "mistral",
    apiModel: "codestral-latest",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  // Qwen Cloud (Alibaba Cloud Model Studio, international/dashscope-intl) --
  // PAID pay-as-you-go, NOT a free tier. Placed late in the fallback chain,
  // after every free option, as a cheap/high-quality paid tier before the
  // priciest last-resort OpenRouter paid models. Verified live 2026-07-20
  // against https://dashscope-intl.aliyuncs.com/compatible-mode/v1.
  "qwen-cloud-max": {
    id: "qwen-cloud-max",
    name: "Qwen Max (Qwen Cloud)",
    provider: "qwen",
    apiModel: "qwen-max",
    // Official Alibaba Cloud Model Studio international pricing, confirmed
    // 2026-07-20: https://www.alibabacloud.com/help/en/model-studio/model-pricing
    inputCostPer1M: 1.6,
    outputCostPer1M: 6.4,
    maxTokens: 4096,
    tier: "strong",
  },
  "qwen-cloud-coder": {
    id: "qwen-cloud-coder",
    name: "Qwen3 Coder Plus (Qwen Cloud)",
    provider: "qwen",
    apiModel: "qwen3-coder-plus",
    // Tiered pricing -- base tier (<=32K input tokens) confirmed 2026-07-20.
    // Rises to $1.80/$9.00 (32K-128K) then higher; capped via
    // maxSafeInputTokens to stay in the cheap tier.
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    maxTokens: 4096,
    maxSafeInputTokens: 30000,
    tier: "strong",
  },
  "kilocode-qwen3-coder": {
    id: "kilocode-qwen3-coder",
    name: "Qwen3 Coder (Kilo Code Free)",
    provider: "kilocode",
    apiModel: "qwen/qwen3-coder:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "kilocode-llama-3.3-70b": {
    id: "kilocode-llama-3.3-70b",
    name: "Llama 3.3 70B (Kilo Code Free)",
    provider: "kilocode",
    apiModel: "meta-llama/llama-3.3-70b-instruct:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
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
  // GitHub Models -- free via existing GITHUB_TOKEN_4 PAT, no separate signup.
  // Genuinely frontier-tier models unlike the rest of the free chain, but
  // GitHub imposes tight per-request token caps -- verified live 2026-07-20
  // (gpt-4.1, codestral-2501, llama-4-maverick all responded; gpt-5-mini,
  // o4-mini, deepseek-r1-0528 returned "Unavailable model" on this token's
  // tier -- left out of the registry below since they don't currently work).
  "github-gpt-4.1": {
    id: "github-gpt-4.1",
    name: "GPT-4.1 (GitHub Models)",
    provider: "github",
    apiModel: "openai/gpt-4.1",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 4096,
    maxSafeInputTokens: 6000,
    tier: "strong",
  },
  "github-codestral": {
    id: "github-codestral",
    name: "Codestral 25.01 (GitHub Models)",
    provider: "github",
    apiModel: "mistral-ai/codestral-2501",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 4096,
    maxSafeInputTokens: 6000,
    tier: "balanced",
  },
  "github-llama-4-maverick": {
    id: "github-llama-4-maverick",
    name: "Llama 4 Maverick (GitHub Models)",
    provider: "github",
    apiModel: "meta/llama-4-maverick-17b-128e-instruct-fp8",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 4096,
    maxSafeInputTokens: 6000,
    tier: "balanced",
  },
};

export const DEFAULT_MODEL = "deepseek-v3";

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
// Swarm defaults. Groq's free tier is too small for a token-heavy swarm
// (gpt-oss-120b caps at 8k tokens/min — can't fit one large prompt; llama-3.3
// caps at 100k tokens/day). So heavy roles route to DeepSeek (paid, topped up,
// no per-minute wall) and Cerebras (free tier, ~1M tokens/day, generous TPM);
// Groq is reserved for small/fast utility calls only. DeepSeek is cheap
// ($0.27/$1.10 per M) and Cerebras GLM 4.7 is free.
export const AGENT_MODELS: Record<string, string> = {
  orchestrator: "deepseek-v3",
  architect: "deepseek-v3",
  coder: "cerebras-glm-4.7",
  reviewer: "cerebras-gpt-oss-120b",
  debugger: "deepseek-reasoner",
  tester: "cerebras-gpt-oss-120b",
  devops: "cerebras-gpt-oss-120b",
  sentry: "groq-llama-3.1-8b",
  forensic: "deepseek-reasoner",
  reflection: "deepseek-v3",
  strategist: "deepseek-v3",
  default: "deepseek-v3",
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
    case "cerebras":
      return "https://api.cerebras.ai/v1";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "azure":
      return process.env.AZURE_OPENAI_ENDPOINT ?? "";
    case "kilocode":
      // kilocode.ai migrated to kilo.ai (confirmed 2026-07-19: old host now
      // 308-redirects here). Old host was silently eating every KiloCode
      // call via a redirect most HTTP clients don't replay POST bodies on.
      return "https://kilo.ai/api/openrouter/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "github":
      // GitHub Models — free tier for existing GitHub PATs, OpenAI-compatible.
      // Tight per-request token caps but genuinely frontier-tier models.
      return "https://models.github.ai/inference";
    case "qwen":
      // Qwen Cloud (Alibaba Cloud Model Studio) international endpoint --
      // NOT the mainland Bailian console, that's a separate account/URL.
      return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  }
}

// Provider → userApiKeys field mapping
const PROVIDER_KEY_MAP: Record<ModelConfig["provider"], string> = {
  anthropic: "anthropic",
  deepseek: "deepseek",
  groq: "groq",
  cerebras: "cerebras",
  google: "google",
  xai: "xai",
  moonshot: "moonshot",
  openai: "openai",
  openrouter: "openrouter",
  azure: "openai",
  kilocode: "kilocode",
  mistral: "mistral",
  github: "github",
  qwen: "qwen",
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
    case "cerebras":
      return process.env.CEREBRAS_API_KEY ?? "";
    case "google":
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    case "openrouter":
      return process.env.OPENROUTER_API_KEY ?? "";
    case "azure":
      return process.env.AZURE_OPENAI_API_KEY ?? "";
    case "kilocode":
      return process.env.KILOCODE_API_KEY ?? "";
    case "mistral":
      return process.env.MISTRAL_API_KEY ?? "";
    case "github":
      return process.env.GITHUB_TOKEN_4 ?? process.env.GITHUB_TOKEN_9 ?? "";
    case "qwen":
      return process.env.QWENCLOUD_API_KEY ?? "";
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
/** Rough token estimate — good enough for a safety-margin truncation check. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * truncateMessagesToFit — trims message content so the total estimated
 * prompt stays under `maxTokens`. Keeps system prompt intact, and for the
 * largest user/assistant message keeps the head + tail (where the actual
 * question/instruction usually lives) and drops the noisy middle.
 */
function truncateMessagesToFit(
  messages: Message[],
  maxTokens: number,
): Message[] {
  const total = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (total <= maxTokens) return messages;

  const systemTokens = messages
    .filter(m => m.role === "system")
    .reduce((n, m) => n + estimateTokens(m.content), 0);
  const budgetForRest = Math.max(500, maxTokens - systemTokens);

  // Find the single largest non-system message — almost always the culprit
  // (full file dumps / logs pasted into one user turn).
  const nonSystem = messages.filter(m => m.role !== "system");
  if (nonSystem.length === 0) return messages;
  const largest = nonSystem.reduce((a, b) =>
    estimateTokens(b.content) > estimateTokens(a.content) ? b : a,
  );
  const largestTokens = estimateTokens(largest.content);
  if (largestTokens <= budgetForRest) return messages;

  const keepChars = Math.max(200, budgetForRest * 4);
  const headChars = Math.floor(keepChars * 0.6);
  const tailChars = Math.floor(keepChars * 0.4);
  const truncatedContent =
    largest.content.length > headChars + tailChars
      ? `${largest.content.slice(0, headChars)}\n\n[...truncated ${
          largest.content.length - headChars - tailChars
        } chars to fit rate limit...]\n\n${largest.content.slice(-tailChars)}`
      : largest.content;

  return messages.map(m =>
    m === largest ? { ...m, content: truncatedContent } : m,
  );
}

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

  let messages: Message[] =
    typeof promptOrMessages === "string"
      ? [
          ...(options.systemPrompt
            ? [{ role: "system" as const, content: options.systemPrompt }]
            : []),
          { role: "user" as const, content: promptOrMessages },
        ]
      : promptOrMessages;

  // Small-TPM-cap models (e.g. Groq free tier) reject oversized requests
  // outright (413) rather than truncating server-side. If this model has a
  // safe input budget configured, trim the largest message(s) to fit before
  // sending — better a shortened debug attempt than a guaranteed failure.
  if (config.maxSafeInputTokens) {
    messages = truncateMessagesToFit(messages, config.maxSafeInputTokens);
  }

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
  // Provider-diverse fallback: if one provider rate-limits (Groq free tier) or
  // errors, the next attempt hits a *different* provider entirely. DeepSeek
  // (paid, no per-minute wall) is the reliable anchor; Cerebras (free) and a
  // tiny Groq model round it out.
  // Free-first chain: cycles through every free/no-balance-required option
  // across DIFFERENT providers/accounts before ever touching a paid model,
  // so a single provider's outage/quota/balance never blocks the app.
  // Order picked to spread load across the most distinct rate-limit buckets:
  // OpenRouter free models -> several separate Groq models (each has its
  // own quota) -> Cerebras free tier -> paid OpenRouter as last resort.
  const fullChain = [
    requested,
    "mistral-codestral",
    "kilocode-qwen3-coder",
    "kilocode-llama-3.3-70b",
    "github-gpt-4.1",
    "github-codestral",
    "github-llama-4-maverick",
    "or-devstral-free",
    "or-qwen3-coder-free",
    "or-llama-3.3-70b-free",
    "or-deepseek-v3-free",
    "or-poolside-free",
    "groq-llama-3.3-70b",
    "groq-gpt-oss-120b",
    "groq-llama-4-scout",
    "groq-qwen3-32b",
    "groq-gpt-oss-20b",
    "groq-llama-3.1-8b",
    "cerebras-glm-4.7",
    "cerebras-gpt-oss-120b",
    "qwen-cloud-coder",
    "qwen-cloud-max",
    "or-deepseek-v3",
    "or-llama-3.3-70b",
    "or-qwen-coder",
  ].filter((m, i, arr) => arr.indexOf(m) === i && MODELS[m]);

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
  // Default: DeepSeek (paid, no rate wall) for planning/reasoning, OpenRouter
  // for execution. Handles large swarm prompts that Groq's free tier rejects.
  // Default profile switched to free-first 2026-07-19: all paid provider
  // balances (OpenRouter/DeepSeek/Cerebras/Gemini) were simultaneously
  // exhausted, breaking "build on an idea". Primary picks are now free-tier
  // (OpenRouter :free models incl. Mistral's Devstral coding-agent model and
  // Poolside Laguna, plus Groq's free tier) — callAIWithFallback's chain
  // still cycles through everything else (more free models, more Groq
  // models, Cerebras, then paid OpenRouter) if a primary pick is down.
  viktor: {
    orchestrator: "or-devstral-free",
    architect: "or-devstral-free",
    coder: "or-qwen3-coder-free",
    reviewer: "or-devstral-free",
    debugger: "groq-qwen3-32b",
    tester: "or-qwen3-coder-free",
    devops: "or-llama-3.3-70b-free",
    sentry: "groq-gpt-oss-20b",
    forensic: "groq-qwen3-32b",
    reflection: "or-devstral-free",
    strategist: "or-devstral-free",
    default: "or-devstral-free",
  },
  // Free: fully free roster (OpenRouter free endpoints + Groq free tier).
  free: {
    orchestrator: "or-devstral-free",
    architect: "or-llama-3.3-70b-free",
    coder: "or-qwen3-coder-free",
    reviewer: "or-devstral-free",
    debugger: "groq-qwen3-32b",
    tester: "or-qwen3-coder-free",
    devops: "or-llama-3.3-70b-free",
    sentry: "groq-gpt-oss-20b",
    forensic: "groq-qwen3-32b",
    reflection: "or-llama-3.3-70b-free",
    strategist: "or-devstral-free",
    default: "or-devstral-free",
  },
  // Budget: all fast cheap models
  budget: {
    orchestrator: "or-llama-3.3-70b",
    architect: "or-llama-3.3-70b",
    coder: "or-llama-3.3-70b",
    reviewer: "or-qwen-coder",
    debugger: "or-llama-3.3-70b",
    tester: "or-qwen-coder",
    devops: "or-qwen-coder",
    sentry: "or-qwen-coder",
    forensic: "or-llama-3.3-70b",
    reflection: "or-llama-3.3-70b",
    strategist: "or-llama-3.3-70b",
    default: "or-llama-3.3-70b",
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
