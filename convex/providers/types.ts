/**
 * Unified Agent Provider Interface
 *
 * Defines the contract for all execution providers — both internal LLM calls
 * and external agent runtimes (OpenHands, Codex CLI, Gemini CLI, Claude Code).
 *
 * The orchestrator routes tasks to providers based on:
 *   - Task type (code, plan, review, test, deploy)
 *   - Cost budget (cheap models for simple tasks, expensive for architecture)
 *   - Availability (fallback chains on failure)
 *   - User preference (BYOK keys determine available providers)
 */

export type AgentCapability =
  | "code"
  | "plan"
  | "review"
  | "test"
  | "deploy"
  | "research"
  | "debug";

export type ProviderId =
  | "internal"
  | "openhands"
  | "codex"
  | "gemini-cli"
  | "claude-code"
  | "copilot";

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface AgentTask {
  id: string;
  type: AgentCapability;
  prompt: string;
  context: string;
  files: string[];
  maxTokens: number;
  timeout: number;
}

export interface AgentResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  tokensUsed: { input: number; output: number };
  durationMs: number;
  error?: string;
}

export interface AgentProvider {
  id: ProviderId;
  name: string;
  capabilities: AgentCapability[];
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;

  execute(task: AgentTask): Promise<AgentResult>;
  estimateCost(task: AgentTask): CostEstimate;
  isAvailable(): boolean;
}

/**
 * Provider registry — maps provider IDs to their configurations.
 * Actual implementations live in sibling files (internal.ts, openhands.ts, etc.)
 */
export interface ProviderConfig {
  id: ProviderId;
  name: string;
  capabilities: AgentCapability[];
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  priority: number; // lower = preferred
}

export const PROVIDER_REGISTRY: ProviderConfig[] = [
  {
    id: "internal",
    name: "CodeForge Internal (DeepSeek/xAI/Moonshot/OpenAI)",
    capabilities: ["code", "plan", "review", "test", "debug", "research"],
    maxContextTokens: 128000,
    supportsStreaming: false,
    supportsTools: true,
    costPer1kInput: 0.00027,
    costPer1kOutput: 0.0011,
    priority: 0,
  },
  {
    id: "claude-code",
    name: "Claude Code (Anthropic)",
    capabilities: ["code", "plan", "review", "test", "debug", "deploy"],
    maxContextTokens: 200000,
    supportsStreaming: true,
    supportsTools: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    priority: 1,
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI (Google)",
    capabilities: ["code", "plan", "review", "research", "debug"],
    maxContextTokens: 1000000,
    supportsStreaming: true,
    supportsTools: true,
    costPer1kInput: 0.000125,
    costPer1kOutput: 0.0005,
    priority: 2,
  },
  {
    id: "codex",
    name: "Codex CLI (OpenAI)",
    capabilities: ["code", "test", "debug", "deploy"],
    maxContextTokens: 128000,
    supportsStreaming: true,
    supportsTools: true,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
    priority: 3,
  },
  {
    id: "openhands",
    name: "OpenHands (Self-hosted)",
    capabilities: ["code", "test", "debug", "deploy", "research"],
    maxContextTokens: 128000,
    supportsStreaming: true,
    supportsTools: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    priority: 4,
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    capabilities: ["code", "review", "debug"],
    maxContextTokens: 128000,
    supportsStreaming: true,
    supportsTools: false,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    priority: 5,
  },
];

/**
 * Select the best provider for a given task type and budget.
 */
export function selectProvider(
  taskType: AgentCapability,
  budgetUsd?: number,
  availableProviders?: ProviderId[],
): ProviderConfig {
  const candidates = PROVIDER_REGISTRY.filter(p => {
    if (!p.capabilities.includes(taskType)) return false;
    if (availableProviders && !availableProviders.includes(p.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    return PROVIDER_REGISTRY[0]; // fallback to internal
  }

  // If budget is tight, prefer cheapest
  if (budgetUsd !== undefined && budgetUsd < 0.01) {
    const cheapest = candidates.sort(
      (a, b) =>
        a.costPer1kInput +
        a.costPer1kOutput -
        (b.costPer1kInput + b.costPer1kOutput),
    );
    return cheapest[0];
  }

  // Otherwise prefer by priority
  return candidates.sort((a, b) => a.priority - b.priority)[0];
}
