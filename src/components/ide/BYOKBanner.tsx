/**
 * BYOKBanner.tsx — Sticky onboarding banner for Lifetime users without API keys
 *
 * Shows at the top of the dashboard when:
 *   - User's plan is "lifetime"
 *   - They have zero API keys saved
 *
 * Dismisses once they add at least one key.
 * Non-modal: sticky top notice with CTA → Settings → API Keys.
 */
import { useQuery } from "convex/react";
import { ArrowRight, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";

export function BYOKBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const limitsData = useQuery(api.limits.getMyLimits);
  const hasKey = useQuery(api.apiKeys.hasAnyKey);

  // Only show for lifetime users who haven't added keys yet
  const isLifetime = limitsData?.plan === "lifetime";
  const needsKeys = hasKey === false;

  if (!isLifetime || !needsKeys || dismissed) return null;

  return (
    <div
      className="relative w-full flex items-center gap-3 px-4 py-3 text-sm"
      style={{
        background:
          "linear-gradient(90deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.06) 100%)",
        borderBottom: "1px solid rgba(245,158,11,0.25)",
      }}
    >
      {/* Icon */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
        style={{ background: "rgba(245,158,11,0.15)" }}
      >
        <KeyRound className="w-4 h-4" style={{ color: "#F59E0B" }} />
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        <span style={{ color: "#F59E0B" }} className="font-semibold">
          Action required:&nbsp;
        </span>
        <span className="text-slate-300">
          Your Lifetime plan uses Bring Your Own Key (BYOK). Add at least one AI
          provider key to unlock the IDE and agent system.
        </span>
      </div>

      {/* CTA */}
      <button
        onClick={() => navigate("/settings?tab=api-keys")}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium text-xs transition-all hover:opacity-90 active:scale-95"
        style={{
          background: "rgba(245,158,11,0.2)",
          border: "1px solid rgba(245,158,11,0.4)",
          color: "#F59E0B",
        }}
      >
        Add API Keys
        <ArrowRight className="w-3 h-3" />
      </button>

      {/* Dismiss — just hides for the session, key requirement still enforced */}
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 rounded transition-colors hover:bg-white/10"
        style={{ color: "#94A3B8" }}
        title="Dismiss (you can still add keys in Settings)"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
