/**
 * AIModelsTab.tsx — Swarm profiles and OpenRouter model catalog settings.
 */
import { useMutation, useQuery } from "convex/react";
import {
  Brain,
  CheckCircle2,
  DollarSign,
  Info,
  Zap,
  Sparkles,
  Shield,
  Layers,
  Search,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";

// ─── Swarm Profiles Metadata ──────────────────────────────────────────────────

const SWARM_PROFILES = [
  {
    id: "viktor",
    name: "Viktor's Pick",
    tagline: "Recommended Swarm Configuration",
    cost: "$0.10–$0.25 / build",
    description: "DeepSeek R1 handles complex plans, Gemini 2.5 Flash writes high-speed code, and Claude 3.5 Haiku catches bugs during reviews. Insane quality/price ratio.",
    reasoning: 5,
    speed: 4,
    priceLevel: 2, // 1-5 scale
    badgeColor: "bg-primary/20 text-primary border-primary/30",
    icon: Sparkles,
    roles: {
      "Planner / Architect": "DeepSeek R1",
      "Coder": "Gemini 2.5 Flash",
      "Reviewer": "Claude 3.5 Haiku",
      "Debugger": "Gemini 2.5 Flash",
    },
  },
  {
    id: "budget",
    name: "Budget Swarm",
    tagline: "Extreme Cost Savings",
    cost: "$0.02–$0.08 / build",
    description: "Uses Qwen Coder for planning, Kimi K2 for code generation, and Gemini Flash for reviews. Spawns 10+ agents for literally pennies.",
    reasoning: 3,
    speed: 4,
    priceLevel: 1,
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: DollarSign,
    roles: {
      "Planner / Architect": "Qwen 2.5 Coder",
      "Coder": "Kimi K2",
      "Reviewer": "Gemini 2.5 Flash",
      "Debugger": "Kimi K2",
    },
  },
  {
    id: "premium",
    name: "Premium Quality",
    tagline: "Uncompromised Software Quality",
    cost: "$0.80–$2.00 / build",
    description: "Claude 3.5 Sonnet architecting and reviewing, OpenAI GPT-4.5 doing the heavy lifting of code generation. Extremely robust but pricier.",
    reasoning: 5,
    speed: 3,
    priceLevel: 5,
    badgeColor: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    icon: Shield,
    roles: {
      "Planner / Architect": "Claude 3.5 Sonnet",
      "Coder": "GPT-4.5 Preview",
      "Reviewer": "Claude 3.5 Sonnet",
      "Debugger": "Claude 3.5 Sonnet",
    },
  },
  {
    id: "reasoning",
    name: "Reasoning Heavy",
    tagline: "Complex Math & Algorithm Tasks",
    cost: "$0.30–$0.60 / build",
    description: "o3-mini reasons about the high-level architecture, DeepSeek R1 executes code logic with deep chain-of-thought, and Claude Haiku reviews.",
    reasoning: 5,
    speed: 3,
    priceLevel: 3,
    badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: Brain,
    roles: {
      "Planner / Architect": "OpenAI o3-mini",
      "Coder": "DeepSeek R1",
      "Reviewer": "Claude 3.5 Haiku",
      "Debugger": "DeepSeek R1",
    },
  },
  {
    id: "speed",
    name: "Speed Demon",
    tagline: "Instantaneous Iterations",
    cost: "$0.05–$0.15 / build",
    description: "Gemini 2.5 Flash does fast planning and debugging, Kimi K2 generates code instantly, and GPT-4o Mini performs blazing-fast reviews.",
    reasoning: 3,
    speed: 5,
    priceLevel: 2,
    badgeColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    icon: Zap,
    roles: {
      "Planner / Architect": "Gemini 2.5 Flash",
      "Coder": "Kimi K2",
      "Reviewer": "GPT-4o Mini",
      "Debugger": "Kimi K2",
    },
  },
];

// ─── Model Catalog Metadata ──────────────────────────────────────────────────

const MODELS = [
  { id: "or-deepseek-reasoner", name: "DeepSeek R1", provider: "OpenRouter", reason: 5, quality: 4, speed: 2, price: "$0.55 / $2.19", costLevel: "$" },
  { id: "or-claude-sonnet", name: "Claude 3.5 Sonnet", provider: "OpenRouter", reason: 5, quality: 5, speed: 3, price: "$3.00 / $15.00", costLevel: "$$$" },
  { id: "or-gemini-flash", name: "Gemini 2.5 Flash", provider: "OpenRouter", reason: 3, quality: 4, speed: 5, price: "$0.15 / $0.60", costLevel: "$" },
  { id: "or-kimi-k2", name: "Kimi K2", provider: "OpenRouter", reason: 3, quality: 3, speed: 4, price: "$0.12 / $0.12", costLevel: "$" },
  { id: "or-gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenRouter", reason: 3, quality: 3, speed: 4, price: "$0.15 / $0.60", costLevel: "$" },
  { id: "or-deepseek-v3", name: "DeepSeek V3", provider: "OpenRouter", reason: 4, quality: 5, speed: 3, price: "$0.28 / $1.14", costLevel: "$" },
  { id: "or-qwen-coder", name: "Qwen 2.5 Coder", provider: "OpenRouter", reason: 3, quality: 4, speed: 4, price: "$0.06 / $0.15", costLevel: "$" },
  { id: "or-llama-3.3-70b", name: "Llama 3.3 70B", provider: "OpenRouter", reason: 3, quality: 4, speed: 4, price: "$0.12 / $0.30", costLevel: "$" },
  { id: "or-grok-4", name: "Grok 4", provider: "OpenRouter", reason: 5, quality: 5, speed: 3, price: "$5.00 / $25.00", costLevel: "$$$$" },
  { id: "or-grok-3", name: "Grok 3", provider: "OpenRouter", reason: 4, quality: 4, speed: 4, price: "$3.00 / $15.00", costLevel: "$$$" },
  { id: "or-o3-mini", name: "o3-mini", provider: "OpenRouter", reason: 5, quality: 4, speed: 4, price: "$1.10 / $4.40", costLevel: "$$" },
  { id: "or-gpt-4-5", name: "GPT-4.5 Preview", provider: "OpenRouter", reason: 5, quality: 5, speed: 2, price: "$3.00 / $15.00", costLevel: "$$$" },
  { id: "or-claude-haiku", name: "Claude 3.5 Haiku", provider: "OpenRouter", reason: 4, quality: 4, speed: 4, price: "$0.80 / $4.00", costLevel: "$$" },
  { id: "or-llama-4-maverick", name: "Llama 4 Maverick", provider: "OpenRouter", reason: 4, quality: 4, speed: 4, price: "$0.20 / $0.60", costLevel: "$" },
  { id: "or-qwen-3-235b", name: "Qwen 3 235B", provider: "OpenRouter", reason: 4, quality: 4, speed: 4, price: "$0.20 / $0.60", costLevel: "$" },
  { id: "or-codestral", name: "Codestral", provider: "OpenRouter", reason: 3, quality: 4, speed: 4, price: "$0.30 / $0.90", costLevel: "$" },
  { id: "or-hermes-3-405b", name: "Hermes 3 405B", provider: "OpenRouter", reason: 4, quality: 4, speed: 3, price: "$0.80 / $0.80", costLevel: "$$" },
  { id: "or-gemini-pro", name: "Gemini 2.5 Pro", provider: "OpenRouter", reason: 5, quality: 4, speed: 4, price: "$1.25 / $10.00", costLevel: "$$" },
];

export function AIModelsTab() {
  const profile = useQuery(api.users.getProfile, {});
  const updateAiProfile = useMutation(api.users.updateAiProfile);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const currentProfile = profile?.aiProfile ?? "viktor";

  const handleSelectProfile = async (id: string) => {
    setSaving(true);
    try {
      await updateAiProfile({ aiProfile: id });
      toast.success(`Swarm Profile switched to ${SWARM_PROFILES.find(p => p.id === id)?.name} ✓`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const filteredModels = MODELS.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase());
    if (filter === "all") return matchesSearch;
    if (filter === "budget") return matchesSearch && m.costLevel === "$";
    if (filter === "mid") return matchesSearch && m.costLevel === "$$";
    if (filter === "premium") return matchesSearch && (m.costLevel === "$$$" || m.costLevel === "$$$$");
    return matchesSearch;
  });

  return (
    <div className="space-y-8">
      {/* ─── Header ─── */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" /> Swarm AI Models & Profiles
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          Select a multi-agent swarm profile to balance reasoning, speed, and API token costs, or browse our OpenRouter-compatible model catalog.
        </p>
      </div>

      {/* ─── Profile Presets ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SWARM_PROFILES.map(p => {
          const Icon = p.icon;
          const isSelected = currentProfile === p.id;
          return (
            <button
              key={p.id}
              onClick={() => handleSelectProfile(p.id)}
              disabled={saving}
              className={`text-left p-5 rounded-xl border flex flex-col justify-between transition-all duration-200 relative overflow-hidden group ${
                isSelected
                  ? "border-primary bg-primary/5 text-white"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-950/70"
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Active</span>
                  <CheckCircle2 className="h-4 w-4 text-primary fill-primary/10" />
                </div>
              )}

              <div>
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-lg ${isSelected ? "bg-primary/10 text-primary" : "bg-zinc-900 text-zinc-400 group-hover:text-zinc-200"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">{p.name}</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{p.tagline}</p>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 mt-3.5 leading-relaxed">{p.description}</p>

                {/* Swarm Setup Preview */}
                <div className="border-t border-dashed border-zinc-900/60 mt-4 pt-3.5 space-y-1.5">
                  {Object.entries(p.roles).map(([role, model]) => (
                    <div key={role} className="flex justify-between text-[11px]">
                      <span className="text-zinc-500">{role}:</span>
                      <span className="font-medium text-zinc-300">{model}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats Indicators */}
              <div className="border-t border-zinc-900/80 mt-4 pt-3.5 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1 text-primary">
                  <DollarSign className="h-3 w-3" />
                  <span className="font-medium">{p.cost}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 flex items-center gap-0.5">
                    Brain: <span className="text-zinc-300 font-semibold">{p.reasoning}/5</span>
                  </span>
                  <span className="text-zinc-500 flex items-center gap-0.5">
                    Speed: <span className="text-zinc-300 font-semibold">{p.speed}/5</span>
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Model Catalog ─── */}
      <div className="border-t border-zinc-900 pt-8 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-md font-semibold text-white flex items-center gap-2">
              <Layers className="h-4 w-4 text-zinc-400" /> Model Catalog & Capabilities
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Exact pricing per 1M tokens (input / output) for the connected models.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-48 bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div className="flex bg-zinc-950 border border-zinc-800 p-0.5 rounded-lg text-xs">
              {["all", "budget", "mid", "premium"].map(t => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-3 py-1 rounded-md capitalize transition-colors duration-150 ${
                    filter === t ? "bg-zinc-900 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border border-zinc-800/80 rounded-xl bg-zinc-950/10 overflow-hidden divide-y divide-zinc-900">
          <div className="grid grid-cols-12 text-[11px] font-semibold text-zinc-500 px-4 py-2.5 bg-zinc-950/40">
            <div className="col-span-3">Model Name</div>
            <div className="col-span-2">Provider</div>
            <div className="col-span-2 text-center">Reasoning</div>
            <div className="col-span-2 text-center">Code Quality</div>
            <div className="col-span-1 text-center">Speed</div>
            <div className="col-span-2 text-right">Pricing (per 1M)</div>
          </div>

          {filteredModels.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 flex flex-col items-center gap-2">
              <Info className="h-4 w-4" />
              No models match your search or filter.
            </div>
          ) : (
            filteredModels.map(m => (
              <div key={m.id} className="grid grid-cols-12 text-xs items-center px-4 py-3 hover:bg-zinc-900/10 transition-colors">
                <div className="col-span-3 font-medium text-white flex items-center gap-1.5">
                  {m.name}
                  <span className="text-[10px] text-zinc-600 font-mono font-normal">({m.id.replace("or-", "")})</span>
                </div>
                <div className="col-span-2 text-zinc-400">{m.provider}</div>
                
                {/* Reasoning Bar */}
                <div className="col-span-2 flex justify-center items-center gap-1 px-4">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(b => (
                      <div key={b} className={`h-2.5 w-1.5 rounded-sm ${b <= m.reason ? "bg-primary" : "bg-zinc-800"}`} />
                    ))}
                  </div>
                </div>

                {/* Quality Bar */}
                <div className="col-span-2 flex justify-center items-center gap-1 px-4">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(b => (
                      <div key={b} className={`h-2.5 w-1.5 rounded-sm ${b <= m.quality ? "bg-violet-500" : "bg-zinc-800"}`} />
                    ))}
                  </div>
                </div>

                {/* Speed Bar */}
                <div className="col-span-1 flex justify-center items-center gap-1">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(b => (
                      <div key={b} className={`h-2.5 w-1.5 rounded-sm ${b <= m.speed ? "bg-cyan-500" : "bg-zinc-800"}`} />
                    ))}
                  </div>
                </div>

                <div className="col-span-2 text-right font-mono text-zinc-300 font-medium">
                  {m.price}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
