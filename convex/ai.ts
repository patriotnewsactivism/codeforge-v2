/**
 * ai.ts — CodeForge AI Router
 *
 * Self-contained multi-model AI layer. No third-party middleware.
 * Calls provider APIs directly with automatic fallback.
 *
 * Supported models:
 *   deepseek-v3          → api.deepseek.com  (DeepSeek V3)
 *   deepseek-chat        → api.deepseek.com  (DeepSeek V3, alias)
 *   grok-3-fast          → api.x.ai          (Grok 3 Fast)
 *   grok-4              → api.x.ai          (Grok 4)
 *   kimi-k2             → api.moonshot.cn   (Kimi K2)
 *   gpt-4o-mini         → api.openai.com    (GPT-4o Mini fallback)
 */

declare const process: { env: Record<string, string | undefined> };

// ─── MODEL REGISTRY ────────────────────────────────────────────────────────

export interface ModelConfig {
  id: string;
  name: string;
  provider: "deepseek" | "xai" | "moonshot" | "openai" | "azure";
  apiModel: string;            // model name sent to the API
  inputCostPer1M: number;      // USD per 1M input tokens
  outputCostPer1M: number;     // USD per 1M output tokens
  maxTokens: number;
  tier: "strong" | "balanced" | "fast";
}

export const MODELS: Record<string, ModelConfig> = {
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  "deepseek-v3": {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    provider: "deepseek",
    apiModel: "deepseek-chat",
    inputCostPer1M: 0.27,
    outputCostPer1M: 1.10,
    maxTokens: 8192,
    tier: "balanced",
  },
  "deepseek-chat": {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    apiModel: "deepseek-chat",
    inputCostPer1M: 0.27,
    outputCostPer1M: 1.10,
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

  // ── xAI / Grok ────────────────────────────────────────────────────────────
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

  // ── Moonshot / Kimi ───────────────────────────────────────────────────────
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

  // ── OpenAI (fallback) ─────────────────────────────────────────────────────
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    apiModel: "gpt-4o-mini",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    maxTokens: 8192,
    tier: "fast",
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    apiModel: "gpt-4o",
    inputCostPer1M: 2.50,
    outputCostPer1M: 10.0,
    maxTokens: 8192,
    tier: "strong",
  },
};

// Default model used when none is specified
export const DEFAULT_MODEL = "deepseek-v3";

// Role → model mapping for the agent system
export const AGENT_MODELS: Record<string, string> = {
  orchestrator:  "grok-4",
  architect:     "grok-4",
  coder:         "deepseek-v3",
  reviewer:      "grok-3-fast",
  debugger:      "deepseek-v3",
  tester:        "deepseek-v3",
  devops:        "deepseek-v3",
  sentry:        "grok-3-fast",
  forensic:      "grok-4",
  reflection:    "grok-4",
  strategist:    "grok-4",
  default:       "deepseek-v3",
};

// ─── PROVIDER BASE URLS ────────────────────────────────────────────────────

function getBaseUrl(provider: ModelConfig["provider"]): string {
  switch (provider) {
    case "deepseek":  return "https://api.deepseek.com/v1";
    case "xai":       return "https://api.x.ai/v1";
    case "moonshot":  return "https://api.moonshot.cn/v1";
    case "openai":    return "https://api.openai.com/v1";
    case "azure":     return process.env.AZURE_OPENAI_ENDPOINT ?? "";
  }
}

function getApiKey(provider: ModelConfig["provider"]): string {
  switch (provider) {
    case "deepseek":  return process.env.DEEPSEEK_API_KEY ?? "";
    case "xai":       return process.env.XAI_API_KEY ?? "";
    case "moonshot":  return process.env.MOONSHOT_API_KEY ?? "";
    case "openai":    return process.env.OPENAI_API_KEY ?? "";
    case "azure":     return process.env.AZURE_OPENAI_API_KEY ?? "";
  }
}

// ─── COST ESTIMATION ──────────────────────────────────────────────────────

export function estimateCost(
  text: string,
  modelId: string,
  isOutput: boolean
): { tokens: number; cost: number } {
  const tokens = Math.ceil(text.length / 4); // ~4 chars per token
  const config = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];
  const costPer1M = isOutput ? config.outputCostPer1M : config.inputCostPer1M;
  return { tokens, cost: (tokens / 1_000_000) * costPer1M };
}

// ─── CORE AI CALL ─────────────────────────────────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICallOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * callAI — the single entry point for all AI calls in CodeForge.
 *
 * Accepts a prompt string OR a messages array.
 * Returns the response text.
 * Throws on hard failure (after fallback exhausted).
 */
export async function callAI(
  promptOrMessages: string | Message[],
  options: AICallOptions = {}
): Promise<string> {
  const modelId = options.model ?? DEFAULT_MODEL;
  const config = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  const messages: Message[] = typeof promptOrMessages === "string"
    ? [
        ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        { role: "user" as const, content: promptOrMessages },
      ]
    : promptOrMessages;

  const baseUrl = getBaseUrl(config.provider);
  const apiKey = getApiKey(config.provider);

  if (!apiKey) {
    throw new Error(
      `No API key configured for provider "${config.provider}". ` +
      `Set ${config.provider.toUpperCase().replace("XAI", "XAI")}_API_KEY in your Convex environment.`
    );
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.apiModel,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? config.maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${config.name} API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json() as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };

  if (json.error) throw new Error(`${config.name}: ${json.error.message}`);

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${config.name} returned empty response`);
  return content;
}

/**
 * callAIWithFallback — tries the requested model, then falls back through
 * a prioritized chain if it fails. Never throws unless ALL models fail.
 */
export async function callAIWithFallback(
  promptOrMessages: string | Message[],
  options: AICallOptions = {}
): Promise<{ text: string; modelUsed: string }> {
  const requested = options.model ?? DEFAULT_MODEL;

  // Build fallback chain: requested → deepseek-v3 → gpt-4o-mini
  const chain = [requested, "deepseek-v3", "gpt-4o-mini"].filter(
    (m, i, arr) => arr.indexOf(m) === i && MODELS[m]
  );

  const errors: string[] = [];

  for (const modelId of chain) {
    try {
      const text = await callAI(promptOrMessages, { ...options, model: modelId });
      return { text, modelUsed: modelId };
    } catch (err) {
      errors.push(`${modelId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All models failed:\n${errors.join("\n")}`);
}

/**
 * getModelForRole — returns the best model ID for a given agent role.
 */
export function getModelForRole(role: string): string {
  return AGENT_MODELS[role.toLowerCase()] ?? AGENT_MODELS.default;
}

