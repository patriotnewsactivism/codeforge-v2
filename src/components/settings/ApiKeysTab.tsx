/**
 * ApiKeysTab.tsx — Secrets manager UI for BYOK API keys
 *
 * Professional secrets-manager feel:
 * - Monospace input fields
 * - Masked display (last 4 chars only)
 * - Per-provider status: configured ✓ / not set
 * - Live validation feedback on save
 * - Remove key with confirmation
 *
 * Only shown to Lifetime plan users.
 */
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: "openrouter" as const,
    name: "OpenRouter",
    label: "One key → dozens of cheap models",
    placeholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
    color: "#22D3EE", // cyan
  },
  {
    id: "anthropic" as const,
    name: "Anthropic",
    label: "Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5",
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    color: "#D97757", // clay
  },
  {
    id: "openai" as const,
    name: "OpenAI",
    label: "GPT-4o / GPT-4o Mini",
    placeholder: "sk-proj-...",
    docsUrl: "https://platform.openai.com/api-keys",
    color: "#10B981", // emerald
  },
  {
    id: "deepseek" as const,
    name: "DeepSeek",
    label: "DeepSeek V3 / R1",
    placeholder: "sk-...",
    docsUrl: "https://platform.deepseek.com/api_keys",
    color: "#06B6D4", // cyan
  },
  {
    id: "xai" as const,
    name: "xAI / Grok",
    label: "Grok 3 Fast / Grok 4",
    placeholder: "xai-...",
    docsUrl: "https://console.x.ai/",
    color: "#8B5CF6", // violet
  },
  {
    id: "moonshot" as const,
    name: "Moonshot / Kimi",
    label: "Kimi K2",
    placeholder: "sk-...",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    color: "#F59E0B", // amber
  },
];

// ─── Single provider row ──────────────────────────────────────────────────────

function ProviderRow({
  provider,
  savedKey,
  onSave,
  onDelete,
}: {
  provider: (typeof PROVIDERS)[number];
  savedKey?: { maskedKey: string; isValid?: boolean; validatedAt?: number };
  onSave: (provider: string, key: string) => Promise<void>;
  onDelete: (provider: string) => Promise<void>;
}) {
  const [inputValue, setInputValue] = useState("");
  const [showInput, setShowInput] = useState(!savedKey);
  const [showRaw, setShowRaw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasKey = !!savedKey;

  const handleSave = async () => {
    if (!inputValue.trim()) return;
    setSaving(true);
    await onSave(provider.id, inputValue.trim());
    setInputValue("");
    setShowInput(false);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setDeleting(true);
    await onDelete(provider.id);
    setDeleting(false);
    setShowInput(true);
    setConfirmDelete(false);
  };

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${hasKey ? `${provider.color}30` : "rgba(255,255,255,0.08)"}`,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{
              background: hasKey ? provider.color : "#475569",
              boxShadow: hasKey ? `0 0 8px ${provider.color}60` : "none",
            }}
          />
          <div>
            <p className="text-sm font-semibold text-slate-200">
              {provider.name}
            </p>
            <p className="text-xs text-slate-500">{provider.label}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          {hasKey ? (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                color: provider.color,
                background: `${provider.color}15`,
                border: `1px solid ${provider.color}30`,
              }}
            >
              <CheckCircle2 className="w-3 h-3" />
              Configured
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium text-slate-500 bg-slate-800 border border-slate-700">
              <AlertCircle className="w-3 h-3" />
              Not set
            </span>
          )}

          {/* Docs link */}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            title={`Get ${provider.name} API key`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Saved key display */}
      {hasKey && !showInput && (
        <div className="flex items-center gap-2">
          <code
            className="flex-1 text-xs px-3 py-2 rounded-md text-slate-400"
            style={{
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.06)",
              letterSpacing: "0.05em",
            }}
          >
            {showRaw
              ? savedKey.maskedKey
              : "•".repeat(20) + savedKey.maskedKey.slice(-4)}
          </code>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded transition-colors"
          >
            {showRaw ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => setShowInput(true)}
            className="text-xs px-2.5 py-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-slate-700 transition-colors"
          >
            Replace
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`text-xs px-2.5 py-1.5 rounded border transition-all ${
              confirmDelete
                ? "text-red-400 border-red-500/50 bg-red-500/10 hover:bg-red-500/20"
                : "text-slate-500 border-slate-700 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/5"
            }`}
          >
            {deleting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : confirmDelete ? (
              "Confirm remove"
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {/* Input for new key */}
      {(!hasKey || showInput) && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={provider.placeholder}
            className="flex-1 text-sm px-3 py-2 rounded-md text-slate-200 placeholder-slate-600 outline-none focus:ring-1 transition-all"
            style={{
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.1)",
              letterSpacing: "0.05em",
            }}
            onFocus={e =>
              (e.currentTarget.style.borderColor = `${provider.color}50`)
            }
            onBlur={e =>
              (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")
            }
          />
          <button
            onClick={handleSave}
            disabled={saving || !inputValue.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-95"
            style={{
              background: saving
                ? "rgba(255,255,255,0.05)"
                : `${provider.color}20`,
              border: `1px solid ${provider.color}40`,
              color: provider.color,
            }}
          >
            {saving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Validating…
              </>
            ) : (
              <>
                <Plus className="w-3 h-3" />
                Save & Verify
              </>
            )}
          </button>
          {hasKey && showInput && (
            <button
              onClick={() => {
                setShowInput(false);
                setInputValue("");
              }}
              className="text-xs px-2.5 py-2 rounded text-slate-500 hover:text-slate-300 border border-slate-700 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ApiKeysTab() {
  const limitsData = useQuery(api.limits.getMyLimits);
  const savedKeys = useQuery(api.apiKeys.listMyKeys);
  const saveKeyAction = useAction(api.apiKeys.saveKey);
  const deleteKeyMutation = useMutation(api.apiKeys.deleteKey);

  const isLifetime = limitsData?.plan === "lifetime";

  const handleSave = async (provider: string, apiKey: string) => {
    try {
      const result = await saveKeyAction({
        provider: provider as "openai" | "deepseek" | "xai" | "moonshot",
        apiKey,
      });
      if (result.success) {
        toast.success(`${provider.toUpperCase()} key verified and saved ✓`);
      } else {
        toast.error(result.error ?? "Failed to save key");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
    }
  };

  const handleDelete = async (provider: string) => {
    try {
      await deleteKeyMutation({
        provider: provider as "openai" | "deepseek" | "xai" | "moonshot",
      });
      toast.success(`${provider.toUpperCase()} key removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove key");
    }
  };

  if (!isLifetime) {
    return (
      <div
        className="rounded-lg p-5 text-sm text-slate-400"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="w-4 h-4 text-slate-500" />
          <p className="font-medium text-slate-300">API Keys</p>
        </div>
        <p>
          Your{" "}
          <strong className="text-slate-200">
            {limitsData?.plan ?? "current"}
          </strong>{" "}
          plan includes AI compute — no API keys needed. Your AI calls use
          CodeForge's shared infrastructure.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" />
            API Keys
            <span className="text-xs px-2 py-0.5 rounded-full font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20">
              Lifetime BYOK
            </span>
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-lg">
            Your Lifetime plan is Bring Your Own Key — your keys are used
            directly for AI calls, so you control costs and usage limits. Keys
            are stored encrypted and never returned in plaintext. Add at least
            one to unlock the IDE.
          </p>
        </div>
      </div>

      {/* Provider rows */}
      <div className="space-y-3">
        {PROVIDERS.map(provider => {
          const saved = savedKeys?.find((k: any) => k.provider === provider.id);
          return (
            <ProviderRow
              key={provider.id}
              provider={provider}
              savedKey={saved}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-xs text-slate-600 leading-relaxed">
        Keys are verified with a lightweight test call before being stored. Only
        the last 4 characters are shown after saving. You can replace or remove
        any key at any time — changes take effect immediately.
      </p>
    </div>
  );
}
