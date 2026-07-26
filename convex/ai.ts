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
    | "qwen"
    | "cohere";
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
  // "groq-llama-4-scout" REMOVED 2026-07-22 -- confirmed via live /v1/models
  // query that Groq no longer offers this model on this account at all
  // (404 model_not_found, not a quota issue). No working substitute needed;
  // groq-gpt-oss-120b already covers the "balanced/strong" tier.
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
    // Model id confirmed live 2026-07-22 via Groq's own /v1/models -- they
    // renamed/replaced qwen/qwen3-32b with qwen/qwen3.6-27b. Key name kept
    // as-is to avoid touching every reference across AGENT_MODELS/profiles.
    name: "Qwen3.6 27B (Groq)",
    provider: "groq",
    apiModel: "qwen/qwen3.6-27b",
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
  // Cohere production tier -- added 2026-07-26 as a confirmed-live, genuinely
  // untapped fallback slot (this deployment had a real COHERE_API_KEY
  // available but no chain entry using it). command-r-plus-08-2024 is the
  // production, non-deprecated chat model (NOT "command-r", removed
  // 2025-09-15).
  "cohere-command-r-plus": {
    id: "cohere-command-r-plus",
    name: "Command R+ (Cohere)",
    provider: "cohere",
    apiModel: "command-r-plus-08-2024",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    maxTokens: 8192,
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
  // ── Kilo Code Gateway — separate free-tier account/quota, proxies the same
  //    OpenRouter model catalog through its own rate limits (kilocode.ai).
  //    Requires KILOCODE_API_KEY. Adding this as its own provider gives the
  //    fallback chain an entirely separate quota bucket from OpenRouter
  //    itself, so if OpenRouter's free tier is rate-limited, Kilo Code's
  //    free tier is very likely still fresh.
  // Real Mistral La Plateforme -- Codestral is Mistral's dedicated coding
  // agent model. La Plateforme has a free tier (~1B tokens/month). Requires
  // MISTRAL_API_KEY. This is the genuine "mistral coding agent model" --
  // "mistral-codestral" elsewhere is a substitute (Cohere) since OpenRouter
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
  // Both specific free model ids below were discontinued by Kilo Code
  // (404 "The free period of this model ended") -- their own error message
  // names the replacement: kilo-auto/free for limited free inference.
  // Pointed both chain slots there 2026-07-22; still two chain attempts,
  // now against a live endpoint instead of two guaranteed 404s.
  // OpenRouter FREE tier re-added 2026-07-22 (last-resort only) -- Don
  // confirmed OPENROUTER_API_KEY is still valid; only the PAID balance
  // stays retired. Re-verified live against openrouter.ai/api/v1/models --
  // the free catalog changed since these were last used, old devstral/
  // qwen-coder/llama-3.3-70b :free ids are gone.
  "or-gpt-oss-20b-free": {
    id: "or-gpt-oss-20b-free",
    name: "GPT-OSS 20B (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "openai/gpt-oss-20b:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "fast",
  },
  "or-nemotron-3-super-free": {
    id: "or-nemotron-3-super-free",
    name: "Nemotron 3 Super 120B (OpenRouter Free)",
    provider: "openrouter",
    apiModel: "nvidia/nemotron-3-super-120b-a12b:free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "strong",
  },
  "kilocode-qwen3-coder": {
    id: "kilocode-qwen3-coder",
    name: "Kilo Auto (Free)",
    provider: "kilocode",
    apiModel: "kilo-auto/free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
  },
  "kilocode-llama-3.3-70b": {
    id: "kilocode-llama-3.3-70b",
    name: "Kilo Auto (Free) 2",
    provider: "kilocode",
    apiModel: "kilo-auto/free",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    maxTokens: 8192,
    tier: "balanced",
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
    maxSafeInputTokens: 5500,
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
    maxSafeInputTokens: 5500,
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
    maxSafeInputTokens: 5500,
    tier: "balanced",
  },};

// 2026-07-26: was "deepseek-v3" -- removed, confirmed erroring ("Insufficient
// Balance") against this deployment's actual DEEPSEEK_API_KEY. Swapped to a
// confirmed-live free-tier model per "remove models that keep returning
// errors, get them out."
export const DEFAULT_MODEL = "cerebras-gpt-oss-120b";

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
// 2026-07-26: every "deepseek-v3"/"deepseek-reasoner" slot below was
// confirmed erroring (Insufficient Balance on this deployment's actual
// DEEPSEEK_API_KEY) -- swapped to confirmed-live free-tier models
// (cerebras-gpt-oss-120b / groq-llama-3.3-70b) per explicit instruction to
// remove providers that keep returning errors.
export const AGENT_MODELS: Record<string, string> = {
  orchestrator: "cerebras-gpt-oss-120b",
  architect: "cerebras-gpt-oss-120b",
  coder: "cerebras-glm-4.7",
  reviewer: "cerebras-gpt-oss-120b",
  debugger: "groq-llama-3.3-70b",
  tester: "cerebras-gpt-oss-120b",
  devops: "cerebras-gpt-oss-120b",
  sentry: "groq-llama-3.1-8b",
  forensic: "groq-llama-3.3-70b",
  reflection: "cerebras-gpt-oss-120b",
  strategist: "cerebras-gpt-oss-120b",
  default: "cerebras-gpt-oss-120b",
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
    case "cohere":
      // Cohere production tier, OpenAI-compatible endpoint. Added
      // 2026-07-26 -- genuinely live/tested key, previously unused on this
      // deployment despite being available. Requires COHERE_API_KEY (a real
      // Production-tab key, NOT the Trial-tab key which hard-caps at
      // 1000 calls/month and returns a "You are using a Trial key" error
      // instead of a completion).
      return "https://api.cohere.com/compatibility/v1";
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
  cohere: "cohere",
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
    case "cohere":
      return process.env.COHERE_API_KEY ?? "";
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

  // Phase 1: Truncate system messages if they alone exceed 60% of budget.
  // Agent system prompts with full file context can blow small-context limits.
  const systemBudget = Math.floor(maxTokens * 0.6);
  let result = messages.map(m => {
    if (m.role === "system" && estimateTokens(m.content) > systemBudget) {
      const keepChars = systemBudget * 4;
      return {
        ...m,
        content: `${m.content.slice(0, keepChars)}\n\n[...system prompt truncated to fit ${maxTokens} token limit...]`,
      };
    }
    return m;
  });

  // Phase 2: Iteratively truncate the largest message until total fits.
  // Handles cases where multiple large messages collectively exceed budget.
  let iterations = 0;
  while (iterations < 5) {
    const currentTotal = result.reduce(
      (n, m) => n + estimateTokens(m.content),
      0,
    );
    if (currentTotal <= maxTokens) break;

    // Find the single largest message
    const largest = result.reduce((a, b) =>
      estimateTokens(b.content) > estimateTokens(a.content) ? b : a,
    );
    const largestTokens = estimateTokens(largest.content);
    if (largestTokens < 200) break; // can't truncate further

    const otherTokens = currentTotal - largestTokens;
    const budgetForLargest = Math.max(200, maxTokens - otherTokens);
    const keepChars = Math.max(200, budgetForLargest * 4);
    const headChars = Math.floor(keepChars * 0.6);
    const tailChars = Math.floor(keepChars * 0.4);

    result = result.map(m => {
      if (m !== largest) return m;
      if (m.content.length <= headChars + tailChars) return m;
      return {
        ...m,
        content: `${m.content.slice(0, headChars)}\n\n[...truncated ${
          m.content.length - headChars - tailChars
        } chars to fit rate limit...]\n\n${m.content.slice(-tailChars)}`,
      };
    });
    iterations++;
  }

  return result;
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
  // errors, the next attempt hits a *different* provider entirely.
  // Free-first chain: cycles through every free/no-balance-required option
  // across DIFFERENT providers/accounts before ever touching a paid model,
  // so a single provider's outage/quota/balance never blocks the app.
  // Order picked to spread load across the most distinct rate-limit buckets:
  // OpenRouter free models -> several separate Groq models (each has its
  // own quota) -> Cerebras free tier -> paid direct-provider models as the
  // final anchor (DeepSeek/Moonshot/OpenAI/xAI — whichever the deployment
  // has a key for) so a day where every free tier is simultaneously
  // exhausted still doesn't surface "All models failed" to the user.
  const fullChain = [
    requested,
    // 2026-07-26: removed per explicit instruction ("remove models that keep
    // returning errors, get them out") -- mistral-codestral (401 Unauthorized,
    // confirmed against this deployment's actual MISTRAL_API_KEY),
    // kilocode-qwen3-coder/kilocode-llama-3.3-70b (402, negative Kilo Code
    // account balance), qwen-cloud-coder/qwen-cloud-max (confirmed
    // "API-key is blocked" against this deployment's actual QWENCLOUD_API_KEY,
    // both the shared and dedicated-workspace endpoints), deepseek-v3
    // (confirmed "Insufficient Balance" against this deployment's actual
    // DEEPSEEK_API_KEY -- also removed as DEFAULT_MODEL/AGENT_MODELS default,
    // see below). github-* kept: got Cloudflare "Too many requests" during
    // this same audit, which is ambiguous (looks like rate-limiting from my
    // own repeated testing today, not the clean structured "no_access" error
    // seen on genuinely-blocked tokens elsewhere) -- was live as recently as
    // 2026-07-20, not removing on an inconclusive signal.
    "groq-llama-3.3-70b",
    "groq-gpt-oss-120b",
    "cerebras-glm-4.7",
    "cerebras-gpt-oss-120b",
    "cohere-command-r-plus",
    "groq-llama-4-scout",
    "groq-qwen3-32b",
    "groq-gpt-oss-20b",
    "groq-llama-3.1-8b",
    // mistral-codestral RE-ADDED 2026-07-26: Don rotated a fresh MISTRAL_API_KEY
    // same-day, confirmed live via direct completion call (codestral-latest,
    // real "OK!" response) before re-adding.
    "mistral-codestral",
    "github-gpt-4.1",
    "github-codestral",
    "github-llama-4-maverick",
    "or-gpt-oss-20b-free",
    "or-nemotron-3-super-free",
    // Paid last resort — only reached once every free option above has
    // failed; each is a no-op if its API key isn't configured (kimi-k2 and
    // gpt-4o-mini have no key configured on this deployment at all, so they
    // were already harmless no-ops, not actively erroring -- left as-is).
    "kimi-k2",
    "gpt-4o-mini",
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
  // Don's Pick: Don's personal default. Qwen Max reasons/plans/reviews,
  // Qwen3 Coder Plus writes and executes code. Two-model combo, both on
  // Don's paid Qwen Cloud workspace -- no free-tier rate walls.
  // 2026-07-26: Qwen Cloud removed entirely -- confirmed "API-key is blocked"
  // on this deployment's actual key, no working replacement in the credential
  // pool. Swapped to the two next-best confirmed-live options: Cohere
  // production (command-r-plus, real headroom, no shared-quota risk) for
  // reasoning/planning/review, Cerebras (free, generous daily tokens) for
  // execution/coding -- closest match to the original "two-model combo, no
  // free-tier rate walls" intent.
  dons_pick: {
    orchestrator: "cohere-command-r-plus",
    architect: "cohere-command-r-plus",
    coder: "cerebras-gpt-oss-120b",
    reviewer: "cohere-command-r-plus",
    debugger: "cerebras-gpt-oss-120b",
    tester: "cerebras-gpt-oss-120b",
    devops: "cerebras-gpt-oss-120b",
    sentry: "cohere-command-r-plus",
    forensic: "cohere-command-r-plus",
    reflection: "cohere-command-r-plus",
    strategist: "cohere-command-r-plus",
    default: "cohere-command-r-plus",
  },
  // Free: fully free roster (OpenRouter free endpoints + Groq free tier).
  // 2026-07-26: mistral-codestral RE-ADDED same day after Don rotated a
  // fresh live key; kilocode-qwen3-coder stays removed (402, still negative
  // balance, unrelated key).
  free: {
    orchestrator: "groq-llama-3.3-70b",
    architect: "groq-llama-3.3-70b",
    coder: "mistral-codestral",
    reviewer: "mistral-codestral",
    debugger: "groq-qwen3-32b",
    tester: "cerebras-glm-4.7",
    devops: "groq-llama-3.3-70b",
    sentry: "groq-gpt-oss-20b",
    forensic: "groq-qwen3-32b",
    reflection: "groq-llama-3.3-70b",
    strategist: "groq-llama-3.3-70b",
    default: "groq-llama-3.3-70b",
  },
  // Budget: all fast cheap models
  // 2026-07-26: qwen-cloud-coder removed (confirmed dead) -- unified on
  // confirmed-live groq-llama-3.3-70b throughout.
  budget: {
    orchestrator: "groq-llama-3.3-70b",
    architect: "groq-llama-3.3-70b",
    coder: "groq-llama-3.3-70b",
    reviewer: "groq-llama-3.3-70b",
    debugger: "groq-llama-3.3-70b",
    tester: "groq-llama-3.3-70b",
    devops: "groq-llama-3.3-70b",
    sentry: "groq-llama-3.3-70b",
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
 *
 * BUGFIX (2026-07-26): previously every sub-agent role call ignored the
 * user's explicit model selection from the chat panel's model picker
 * (session.model) -- only the very first top-level orchestrator turn in
 * chat.ts respected `args.model`. Every downstream role (Coder/Reviewer/
 * Architect/Tester/etc, spawned across ~19 call sites in engine.ts,
 * planner.ts, codeReview.ts, debate.ts, forensic.ts, reflection.ts,
 * ciGenerator.ts, gitops.ts, mutation.ts, crossProject.ts,
 * errorIngestion.ts, repoImport.ts, spawnEngine.ts, xray.ts, autoLearn.ts)
 * instead silently pulled from the hardcoded MODEL_PROFILES swarm-profile
 * table, regardless of what the user picked in the UI.
 *
 * Fix: when a `projectId` is supplied, look up that project's most recent
 * chat session and -- if it has an explicit model set -- use it directly
 * for EVERY role, short-circuiting the profile-based routing entirely.
 * This matches the actual UI: the model picker has no "Automatic" option,
 * every choice is a concrete model id, so the user's pick is meant to win
 * everywhere. Profile-based routing (MODEL_PROFILES) now only applies as
 * a fallback when no project/session context is available at all.
 */
export async function getModelForRole(
  ctx: any,
  role: string,
  projectId?: string,
): Promise<string> {
  if (projectId) {
    try {
      // NOTE: most callers are Convex actions (they call external LLM APIs),
      // which have no direct ctx.db access -- must go through ctx.runQuery.
      //
      // CORRECTION (2026-07-26): this originally queried api.sessions.* (the
      // `sessions` table) -- that table turned out to be dead/unused code,
      // never written to by the real chat flow, so the lookup always
      // silently returned null and this whole override was a no-op. The
      // REAL model picker in ChatPanel.tsx writes to the `chatSessions`
      // table via api.chat.updateModel. Fixed to query the right table.
      const sessionModel = await ctx.runQuery(
        api.chat.getLatestModelForProjectInternal,
        { projectId },
      );
      // "auto" is the model picker's explicit "use automatic/profile-based
      // routing" choice -- not a real model id, so it must NOT short-circuit
      // here. Only a genuine concrete model id counts as a user override.
      if (sessionModel && sessionModel !== "auto") return sessionModel;
    } catch (_err) {
      // Fall through to profile-based routing if the session lookup fails.
    }
  }

  let profile = "dons_pick";
  try {
    profile = await ctx.runQuery(api.users.getAiProfileInternal, {});
  } catch (_err) {
    // Fall back to default profile if query fails or auth issues
  }
  const profileMap = MODEL_PROFILES[profile] ?? MODEL_PROFILES.dons_pick;
  return (
    profileMap[role.toLowerCase()] ??
    profileMap.default ??
    AGENT_MODELS[role.toLowerCase()] ??
    AGENT_MODELS.default
  );
}
