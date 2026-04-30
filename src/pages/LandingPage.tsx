import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Bot,
  GitBranch,
  DollarSign,
  Monitor,
  Eye,
  Users,
  ArrowRight,
  Code2,
  Sparkles,
} from "lucide-react";

const FEATURES = [
  {
    icon: Bot,
    title: "Multi-Model AI",
    description:
      "DeepSeek V3.2, Grok 4.1 Fast, GPT-5 Mini — switch models per-message. Automatic fallback if one fails.",
    color: "text-green-400",
    bgColor: "bg-green-400/10",
  },
  {
    icon: GitBranch,
    title: "GitHub Integration",
    description:
      "Import any repo, browse the full file tree, edit files, and commit changes back to GitHub.",
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
  },
  {
    icon: DollarSign,
    title: "Cost Tracking",
    description:
      "Real-time token usage and dollar amounts. Know exactly what each AI interaction costs, per session.",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
  },
  {
    icon: Monitor,
    title: "Full IDE Experience",
    description:
      "File tree explorer, tabbed code editor with syntax highlighting, keyboard shortcuts (Ctrl+S to save).",
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

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[oklch(0.75_0.18_190)] rounded-full opacity-[0.03] blur-[100px]" />
        </div>

        <div className="container relative z-10 py-24 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[oklch(0.18_0.02_260)] border border-border text-xs text-muted-foreground mb-6">
              <Sparkles className="h-3 w-3 text-primary" />
              Multi-Model AI · GitHub Sync · Cost Tracking · Live Collab
            </div>

            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Code smarter with{" "}
              <span className="text-primary glow-cyan">CodeForge</span>
            </h1>

            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Your AI-powered coding platform. Import GitHub repos, write code
              with intelligent AI assistants, collaborate in real-time, and keep
              full control of costs.
            </p>

            <div className="flex items-center justify-center gap-4">
              <Button
                size="lg"
                className="gap-2 px-8"
                onClick={() => navigate("/signup")}
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/login")}
              >
                Sign In
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors"
              >
                <div
                  className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center mb-4`}
                >
                  <feature.icon className={`h-5 w-5 ${feature.color}`} />
                </div>
                <h3 className="text-base font-semibold mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Code2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">CodeForge</span>
            <span>— Built with ❤️</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
