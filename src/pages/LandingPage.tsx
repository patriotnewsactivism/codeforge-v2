import {
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Code2,
  DollarSign,
  Eye,
  Film,
  GitBranch,
  GitPullRequest,
  Globe,
  Import,
  Menu,
  Monitor,
  Radio,
  Shield,
  Sparkles,
  Swords,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const CORE_FEATURES = [
  {
    icon: Bot,
    title: "Multi-Model AI",
    description:
      "DeepSeek, Grok 4, GPT-4o — routed automatically per task. Automatic fallback if one fails.",
    color: "text-green-400",
    bgColor: "bg-green-400/10",
  },
  {
    icon: GitBranch,
    title: "GitHub Integration",
    description:
      "Import any repo, browse the full file tree, edit files, and commit changes back to GitHub — one click.",
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
  },
  {
    icon: DollarSign,
    title: "Cost Tracking",
    description:
      "Real-time token usage and dollar amounts per session. Know exactly what each AI interaction costs.",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
  },
  {
    icon: Monitor,
    title: "Full IDE Experience",
    description:
      "File tree explorer, tabbed Monaco editor with syntax highlighting, Ctrl+S to save.",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
  },
  {
    icon: Eye,
    title: "Live Preview",
    description:
      "Built-in sandbox previews your HTML/CSS/JS in real-time. See what the AI builds instantly.",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
  },
  {
    icon: Users,
    title: "Live Collaboration",
    description:
      "Real-time presence, watch others code live, and cue the AI with @codeforge. Your team, one workspace.",
    color: "text-pink-400",
    bgColor: "bg-pink-400/10",
  },
];

const V2_FEATURES = [
  {
    icon: Film,
    badge: "New in v2",
    badgeColor: "text-violet-400 bg-violet-400/10 border-violet-400/20",
    title: "Live Mission Cinema",
    description:
      "Replay any past mission frame-by-frame. Watch every agent spawn, tool call, and debate round like a movie. Scrub the timeline, pause at any moment, see what each agent was thinking.",
    color: "text-violet-400",
    bgColor: "bg-violet-400/10",
    stat: "Full timeline replay",
    statColor: "text-violet-400",
  },
  {
    icon: Brain,
    badge: "New in v2",
    badgeColor: "text-sky-400 bg-sky-400/10 border-sky-400/20",
    title: "Cross-Project Intelligence",
    description:
      "Lessons learned don't stay siloed. A bug pattern fixed in Project A surfaces as a warning in Project B. CodeForge builds a global knowledge graph across everything you've ever built.",
    color: "text-sky-400",
    bgColor: "bg-sky-400/10",
    stat: "Global insight library",
    statColor: "text-sky-400",
  },
  {
    icon: Swords,
    badge: "New in v2",
    badgeColor: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    title: "Agent vs Agent Benchmarks",
    description:
      "Same prompt, two models, blind judge (Grok 4) scores both on 4 dimensions. Win rates tracked per model per role. The Strategist reads the leaderboard weekly and auto-reassigns models.",
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    stat: "Auto model optimization",
    statColor: "text-orange-400",
  },
  {
    icon: Radio,
    badge: "New in v2",
    badgeColor: "text-red-400 bg-red-400/10 border-red-400/20",
    title: "Live Error Ingestion",
    description:
      "Connect Sentry, Datadog, or Bugsnag. When a production error fires, CodeForge spins up Forensic → Fixer → PR automatically. Bug reported at 3am, PR open by 3:05am. Zero human involvement.",
    color: "text-red-400",
    bgColor: "bg-red-400/10",
    stat: "~5 min to open PR",
    statColor: "text-red-400",
  },
  {
    icon: BarChart3,
    badge: "New in v2",
    badgeColor: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    title: "Analytics Dashboard",
    description:
      "8 live panels: mission success rates, deployment pipeline, Sentry violation heatmap, debate verdict breakdown, learning loop health, memory categories, incident auto-fix rate, benchmark leaderboard.",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    stat: "8 real-time panels",
    statColor: "text-emerald-400",
  },
  {
    icon: Import,
    badge: "New in v2",
    badgeColor: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    title: "One-Click Repo Import",
    description:
      "Paste any GitHub URL. CodeForge clones it, detects your stack (React/TypeScript/Convex/Rust/Go), runs the Architect to generate a PROJECT_BRIEF.md, injects cross-project warnings, and marks it ready.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/10",
    stat: "Stack auto-detected",
    statColor: "text-yellow-400",
  },
];

const LEARNING_LOOP_STEPS = [
  {
    icon: Shield,
    label: "Forensic Agent",
    desc: "Diagnoses exactly why a mission failed — wrong prompt, model hallucination, bad tool sequence.",
    color: "text-red-400",
  },
  {
    icon: GitPullRequest,
    label: "Mutation Engine",
    desc: "Converts approved fixes into versioned patches. Rollback is one call.",
    color: "text-amber-400",
  },
  {
    icon: TrendingUp,
    label: "Reflection Agent",
    desc: "Runs nightly, approves safe fixes, extracts lessons injected into future agent prompts.",
    color: "text-green-400",
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [promptValue, setPromptValue] = useState("");

  const handlePromptSubmit = () => {
    navigate("/signup");
  };

  return (
    <div className="min-h-screen relative">
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md md:hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 font-bold text-lg">
              <Code2 className="h-5 w-5 text-primary" />
              <span>CodeForge</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 -mr-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="px-5 py-8 space-y-6">
            <button
              type="button"
              className="block text-lg text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                navigate("/login");
                setMobileMenuOpen(false);
              }}
            >
              Sign In
            </button>
            <Button
              size="lg"
              className="w-full gap-2"
              onClick={() => {
                navigate("/signup");
                setMobileMenuOpen(false);
              }}
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-5 md:px-8 lg:px-12 h-14 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Code2 className="h-5 w-5 text-primary" />
            <span>CodeForge</span>
            <span className="hidden sm:inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/20">
              v2
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <a href="/login">Sign In</a>
            </Button>
            <Button asChild size="sm">
              <a href="/signup">Get Started</a>
            </Button>
          </nav>
          <div className="flex md:hidden items-center gap-2">
            <Button size="sm" onClick={() => navigate("/signup")}>
              Get Started
            </Button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -mr-2"
            >
              <Menu className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[oklch(0.75_0.18_190)] rounded-full opacity-[0.04] blur-[120px]" />
        </div>
        <div className="relative z-10 px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="pt-16 md:pt-24 lg:pt-32 pb-8 md:pb-12 max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[oklch(0.18_0.02_260)] border border-border text-xs text-muted-foreground mb-8">
              <Sparkles className="h-3 w-3 text-primary" />
              <span>AI Agent Orchestration Platform — v2 now live</span>
            </div>
            <h1 className="text-3xl sm:text-[2.25rem] leading-[1.1] md:text-5xl lg:text-6xl font-bold tracking-tight mb-5">
              The AI coding platform
              <br />
              <span className="text-primary">
                that gets smarter after every failure
              </span>
            </h1>
            <p className="text-muted-foreground text-base md:text-lg mb-10 max-w-xl mx-auto leading-relaxed">
              Multi-agent swarms write, review, and deploy your code. A Learning
              Loop diagnoses every mistake and injects lessons into future
              missions. Production errors auto-fix themselves.
            </p>

            {/* Prompt input */}
            <div className="max-w-xl mx-auto mb-6">
              <div className="flex items-center gap-2 p-2 rounded-xl border border-border bg-card/60 backdrop-blur">
                <div className="flex-1 flex items-center gap-2 pl-2">
                  <Code2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    placeholder="Build me a SaaS dashboard..."
                    value={promptValue}
                    onChange={e => setPromptValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handlePromptSubmit()}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
                  onClick={handlePromptSubmit}
                >
                  <ArrowRight className="h-4 w-4 text-primary-foreground" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {[
                "SaaS dashboard",
                "Fix production bug",
                "Import GitHub repo",
                "Multi-agent task",
              ].map(s => (
                <button
                  key={s}
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                  onClick={() =>
                    setPromptValue(`Build me a ${s.toLowerCase()}`)
                  }
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap justify-center gap-6 md:gap-10 pt-4 border-t border-border/50">
              {[
                { value: "40", label: "database tables" },
                { value: "28", label: "backend files" },
                { value: "6", label: "v2 features" },
                { value: "~5 min", label: "bug → PR" },
              ].map(({ value, label }) => (
                <div key={label} className="text-center">
                  <div className="text-lg font-bold text-foreground">
                    {value}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* v2 Features — the 6 big ones */}
      <section className="py-16 md:py-24 bg-[oklch(0.10_0.01_260/0.4)]">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-medium mb-4">
              <Zap className="h-3 w-3" />
              What's new in v2
            </div>
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Six features that change everything
            </h2>
            <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
              1,847 lines shipped in one commit. The backend is complete — 40
              tables, 28 files, fully wired.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
            {V2_FEATURES.map(feature => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-5 md:p-6 hover:border-primary/30 transition-all hover:-translate-y-0.5 group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center`}
                  >
                    <feature.icon className={`h-5 w-5 ${feature.color}`} />
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${feature.badgeColor}`}
                  >
                    {feature.badge}
                  </span>
                </div>
                <h3 className="text-sm md:text-base font-semibold mb-2">
                  {feature.title}
                </h3>
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed mb-4">
                  {feature.description}
                </p>
                <div
                  className={`text-xs font-medium ${feature.statColor} flex items-center gap-1`}
                >
                  <Zap className="h-3 w-3" />
                  {feature.stat}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Learning Loop section */}
      <section className="py-16 md:py-20">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-xs uppercase tracking-widest text-muted-foreground/60 mb-3">
                The brain behind v2
              </p>
              <h2 className="text-2xl md:text-3xl font-bold mb-3">
                The Learning Loop
              </h2>
              <p className="text-muted-foreground text-sm md:text-base max-w-lg mx-auto">
                Every failure makes the system smarter. Forensic diagnoses it.
                Mutation patches it. Reflection injects the lesson into every
                future mission.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {LEARNING_LOOP_STEPS.map((step, i) => (
                <div
                  key={step.label}
                  className="relative rounded-xl border border-border bg-card p-5 text-center"
                >
                  {i < LEARNING_LOOP_STEPS.length - 1 && (
                    <div className="hidden md:block absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                      <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div
                    className={`w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center mx-auto mb-3`}
                  >
                    <step.icon className={`h-5 w-5 ${step.color}`} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground/60 mb-1">
                    Step {i + 1}
                  </p>
                  <h3 className="text-sm font-semibold mb-2">{step.label}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-16 md:py-20 bg-[oklch(0.10_0.01_260/0.4)]">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-10 md:mb-12">
            <p className="text-xs uppercase tracking-widest text-muted-foreground/60 mb-3">
              Everything you need
            </p>
            <h2 className="text-2xl md:text-3xl font-bold">
              Built for real developers
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto">
            {CORE_FEATURES.map(feature => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-5 md:p-6 hover:border-primary/30 transition-colors"
              >
                <div
                  className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center mb-3`}
                >
                  <feature.icon className={`h-5 w-5 ${feature.color}`} />
                </div>
                <h3 className="text-sm md:text-base font-semibold mb-1.5">
                  {feature.title}
                </h3>
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28">
        <div className="px-5 md:px-8 max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-medium mb-6">
            <Globe className="h-3 w-3" />
            Free to start
          </div>
          <h2 className="text-2xl md:text-4xl font-bold mb-4">
            Ready to build with an AI swarm that never forgets a mistake?
          </h2>
          <p className="text-muted-foreground mb-8 text-sm md:text-base">
            Import your first repo in 60 seconds. The agents take it from there.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="gap-2"
              onClick={() => navigate("/signup")}
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/login")}
            >
              Sign in
            </Button>
          </div>
          <p className="text-sm text-slate-400 mt-6">
            * Lifetime plan is Bring Your Own Key — supply your AI provider API
            key and we'll never charge you for compute.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="px-5 md:px-8 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Code2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">CodeForge v2</span>
            <span>— AI agents that learn from every failure</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
