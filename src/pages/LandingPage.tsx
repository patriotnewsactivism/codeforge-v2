import { useConvexAuth } from "convex/react";
import {
  AnimatePresence,
  motion,
  useInView,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
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
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

// ─── ANIMATED TYPING EFFECT ───────────────────────────────────────────────────

function TypingText({
  texts,
  className,
}: {
  texts: string[];
  className?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const target = texts[currentIndex]!;
    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          setCurrentText(target.slice(0, currentText.length + 1));
          if (currentText.length === target.length) {
            setTimeout(() => setIsDeleting(true), 2000);
          }
        } else {
          setCurrentText(target.slice(0, currentText.length - 1));
          if (currentText.length === 0) {
            setIsDeleting(false);
            setCurrentIndex((currentIndex + 1) % texts.length);
          }
        }
      },
      isDeleting ? 30 : 60,
    );
    return () => clearTimeout(timeout);
  }, [currentText, isDeleting, currentIndex, texts]);

  return (
    <span className={className}>
      {currentText}
      <span className="animate-pulse text-primary">|</span>
    </span>
  );
}

// ─── ANIMATED COUNTER ─────────────────────────────────────────────────────────

function AnimatedCounter({
  value,
  suffix = "",
  prefix = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    const duration = 1500;
    const steps = 40;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [isInView, value]);

  return (
    <span ref={ref}>
      {prefix}
      {count}
      {suffix}
    </span>
  );
}

// ─── FLOATING PARTICLE ─────────────────────────────────────────────────────────

function FloatingParticle({
  delay,
  size,
  x,
  y,
}: {
  delay: number;
  size: number;
  x: string;
  y: string;
}) {
  return (
    <motion.div
      className="absolute rounded-full bg-primary/20"
      style={{ width: size, height: size, left: x, top: y }}
      animate={{
        y: [0, -20, 0, 20, 0],
        opacity: [0.2, 0.5, 0.3, 0.6, 0.2],
        scale: [1, 1.2, 1, 0.9, 1],
      }}
      transition={{
        duration: 6 + delay,
        repeat: Number.POSITIVE_INFINITY,
        delay,
        ease: "easeInOut",
      }}
    />
  );
}

// ─── SECTION WRAPPER WITH SCROLL ANIMATION ──────────────────────────────────

function FadeInSection({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── DATA ───────────────────────────────────────────────────────────────────────

const CORE_FEATURES = [
  {
    icon: Bot,
    title: "Multi-Model AI",
    description:
      "DeepSeek, Grok, GPT-4o — routed automatically per task. Automatic fallback if one fails.",
    color: "text-green-400",
    bgColor: "bg-green-400/10",
    borderColor: "border-green-400/20",
  },
  {
    icon: GitBranch,
    title: "GitHub Integration",
    description:
      "Import any repo, browse the full file tree, edit files, and commit changes back to GitHub.",
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
    borderColor: "border-cyan-400/20",
  },
  {
    icon: DollarSign,
    title: "Cost Tracking",
    description:
      "Real-time token usage and dollar amounts per session. Know exactly what each AI call costs.",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
    borderColor: "border-amber-400/20",
  },
  {
    icon: Monitor,
    title: "Full IDE Experience",
    description:
      "File tree, tabbed Monaco editor with syntax highlighting, diff viewer, live preview, and more.",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    borderColor: "border-purple-400/20",
  },
  {
    icon: Eye,
    title: "Live Preview",
    description:
      "Built-in sandbox previews your code in real-time. See what the AI builds instantly.",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    borderColor: "border-blue-400/20",
  },
  {
    icon: Users,
    title: "Real-Time Collaboration",
    description:
      "Presence indicators, live cursors, shareable preview links with password protection.",
    color: "text-pink-400",
    bgColor: "bg-pink-400/10",
    borderColor: "border-pink-400/20",
  },
];

const V2_FEATURES = [
  {
    icon: Film,
    badge: "New in v2",
    badgeColor: "text-violet-400 bg-violet-400/10 border-violet-400/20",
    title: "Live Mission Cinema",
    description:
      "Replay any past mission frame-by-frame. Watch every agent spawn, tool call, and debate round like a movie.",
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
      "A bug pattern fixed in Project A surfaces as a warning in Project B. Global knowledge graph across everything you build.",
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
      "Same prompt, two models, blind judge scores both on 4 dimensions. Win rates tracked per model per role.",
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
      "Connect Sentry or Datadog. When a production error fires, CodeForge spins up Forensic → Fixer → PR automatically.",
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
      "8 live panels: mission success rates, deployment pipeline, Sentry violations, debate verdicts, and more.",
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
      "Paste any GitHub URL. CodeForge clones it, detects your stack, generates a project brief, and marks it ready.",
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
    bgColor: "bg-red-400/10",
  },
  {
    icon: GitPullRequest,
    label: "Mutation Engine",
    desc: "Converts approved fixes into versioned patches. Rollback is one call.",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
  },
  {
    icon: TrendingUp,
    label: "Reflection Agent",
    desc: "Runs nightly, approves safe fixes, extracts lessons injected into future agent prompts.",
    color: "text-green-400",
    bgColor: "bg-green-400/10",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Describe Your Idea",
    desc: "Type what you want to build. CodeForge interviews you briefly if needed, then creates a plan.",
    color: "text-cyan-400",
  },
  {
    step: "02",
    title: "Agents Build It",
    desc: "An autonomous swarm of specialized agents writes code, creates files, and reviews each other's work.",
    color: "text-violet-400",
  },
  {
    step: "03",
    title: "Review & Approve",
    desc: "See every file change as a diff. Approve, reject, or ask for modifications. You're always in control.",
    color: "text-amber-400",
  },
  {
    step: "04",
    title: "Deploy & Iterate",
    desc: "One-click deployment. The AI remembers every decision for next time, getting smarter with each build.",
    color: "text-green-400",
  },
];

// ─── COMPONENT ──────────────────────────────────────────────────────────────────

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [promptValue, setPromptValue] = useState("");
  const heroRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.8], [1, 0.95]);

  const handlePromptSubmit = () => {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/signup");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* ── Ambient background effects ─────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[oklch(0.75_0.18_190)] rounded-full opacity-[0.03] blur-[150px]" />
        <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] bg-[oklch(0.65_0.20_280)] rounded-full opacity-[0.02] blur-[120px]" />
        <div className="absolute top-1/2 left-0 w-[400px] h-[400px] bg-[oklch(0.65_0.19_155)] rounded-full opacity-[0.02] blur-[100px]" />
        <FloatingParticle delay={0} size={4} x="15%" y="20%" />
        <FloatingParticle delay={1.5} size={3} x="80%" y="15%" />
        <FloatingParticle delay={0.8} size={5} x="60%" y="35%" />
        <FloatingParticle delay={2} size={3} x="25%" y="60%" />
        <FloatingParticle delay={1.2} size={4} x="75%" y="70%" />
        <FloatingParticle delay={0.5} size={6} x="40%" y="80%" />
        <FloatingParticle delay={1.8} size={3} x="90%" y="50%" />
      </div>

      {/* ── Mobile menu overlay ────────────────────────────────────────── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/98 backdrop-blur-xl md:hidden"
          >
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
                  navigate("/pricing");
                  setMobileMenuOpen(false);
                }}
              >
                Pricing
              </button>
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
                Start Building Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 md:px-8 lg:px-12 h-14 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 font-bold text-lg">
            <div className="relative">
              <Code2 className="h-5 w-5 text-primary" />
              <div className="absolute -inset-1 bg-primary/20 rounded-full blur-sm" />
            </div>
            <span>CodeForge</span>
            <span className="hidden sm:inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/20">
              v2
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <a href="/pricing">Pricing</a>
            </Button>
            {isAuthenticated ? (
              <Button asChild size="sm">
                <a href="/dashboard">Dashboard</a>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <a href="/login">Sign In</a>
                </Button>
                <Button asChild size="sm" className="gap-1.5">
                  <a href="/signup">
                    Start Building
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </>
            )}
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

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative"
      >
        <div className="relative z-10 px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="pt-16 md:pt-24 lg:pt-32 pb-8 md:pb-12 max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[oklch(0.18_0.02_260)] border border-primary/20 text-xs text-muted-foreground mb-8"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span>
                AI Agent Orchestration Platform —{" "}
                <span className="text-primary font-medium">v2 now live</span>
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="text-3xl sm:text-[2.5rem] leading-[1.08] md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6"
            >
              Describe your app.
              <br />
              <span className="bg-gradient-to-r from-primary via-[oklch(0.70_0.16_220)] to-[oklch(0.65_0.20_280)] bg-clip-text text-transparent">
                AI agents build it.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="text-muted-foreground text-base md:text-lg mb-10 max-w-xl mx-auto leading-relaxed"
            >
              Multi-agent swarms write, review, and deploy your code. A learning
              loop diagnoses every mistake and injects lessons into future
              missions.
            </motion.p>

            {/* ── Prompt input ─────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="max-w-xl mx-auto mb-5"
            >
              <div className="group relative flex items-center gap-2 p-2 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm transition-all focus-within:border-primary/40 focus-within:shadow-[0_0_30px_-5px] focus-within:shadow-primary/20">
                <div className="flex-1 flex items-center gap-2.5 pl-3">
                  <Sparkles className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                  <input
                    type="text"
                    placeholder="Build me a..."
                    value={promptValue}
                    onChange={e => setPromptValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handlePromptSubmit()}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
                    aria-label="Describe what you want to build"
                  />
                </div>
                <button
                  type="button"
                  className="shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                  onClick={handlePromptSubmit}
                  aria-label="Start building"
                >
                  <ArrowRight className="h-4 w-4 text-primary-foreground" />
                </button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="flex flex-wrap justify-center gap-2 mb-8"
            >
              {[
                "SaaS dashboard",
                "Campaign site",
                "E-commerce store",
                "AI chatbot",
                "CRM tool",
              ].map(s => (
                <button
                  key={s}
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-full border border-border/50 text-muted-foreground/70 hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
                  onClick={() =>
                    setPromptValue(`Build me a ${s.toLowerCase()}`)
                  }
                >
                  {s}
                </button>
              ))}
            </motion.div>

            {/* ── Typing demo ──────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="max-w-lg mx-auto mb-10"
            >
              <div className="rounded-xl border border-border/40 bg-[oklch(0.10_0.02_260)] p-4 text-left">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 font-mono ml-2">
                    CodeForge Terminal
                  </span>
                </div>
                <div className="font-mono text-xs leading-relaxed">
                  <span className="text-muted-foreground/50">$ </span>
                  <TypingText
                    texts={[
                      "Build me a membership site with paid subscriptions",
                      "Fix the auth bug in my React app",
                      "Create a CRM with contacts and deal tracking",
                      "Import my GitHub repo and add dark mode",
                    ]}
                    className="text-primary"
                  />
                </div>
              </div>
            </motion.div>

            {/* ── Stats row ─────────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 1 }}
              className="flex flex-wrap justify-center gap-8 md:gap-12 pt-6 border-t border-border/30"
            >
              {[
                {
                  value: 40,
                  suffix: "+",
                  label: "Database Tables",
                },
                { value: 56, suffix: "", label: "Backend Modules" },
                { value: 29, suffix: "", label: "IDE Components" },
                {
                  value: 5,
                  suffix: " min",
                  prefix: "~",
                  label: "Bug → PR",
                },
              ].map(({ value, suffix, prefix, label }) => (
                <div key={label} className="text-center">
                  <div className="text-xl md:text-2xl font-bold text-foreground">
                    <AnimatedCounter
                      value={value}
                      suffix={suffix}
                      prefix={prefix}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                    {label}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* ── How It Works ───────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 relative z-10">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <FadeInSection className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground/50 mb-3 font-medium">
              How it works
            </p>
            <h2 className="text-2xl md:text-3xl font-bold">
              From idea to deployed app in minutes
            </h2>
          </FadeInSection>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {HOW_IT_WORKS.map((item, i) => (
              <FadeInSection key={item.step} delay={i * 0.1}>
                <div className="relative rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-5 h-full group hover:border-primary/20 transition-all hover:-translate-y-0.5">
                  <div
                    className={`text-3xl font-black ${item.color} opacity-20 mb-2 font-mono`}
                  >
                    {item.step}
                  </div>
                  <h3 className="text-sm font-semibold mb-2">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                      <ArrowRight className="h-4 w-4 text-muted-foreground/20" />
                    </div>
                  )}
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── v2 Features ────────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-transparent via-[oklch(0.10_0.01_260/0.6)] to-transparent relative z-10">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <FadeInSection className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-medium mb-4">
              <Zap className="h-3 w-3" />
              What's new in v2
            </div>
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Six features that change everything
            </h2>
            <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
              Fully wired backend with 40+ tables, self-learning agents, and
              autonomous error repair.
            </p>
          </FadeInSection>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            {V2_FEATURES.map((feature, i) => (
              <FadeInSection key={feature.title} delay={i * 0.08}>
                <div className="rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-5 md:p-6 hover:border-primary/20 transition-all hover:-translate-y-0.5 group h-full">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center ring-1 ring-inset ring-white/5`}
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
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Learning Loop ──────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 relative z-10">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto">
            <FadeInSection className="text-center mb-10">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground/50 mb-3 font-medium">
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
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {LEARNING_LOOP_STEPS.map((step, i) => (
                <FadeInSection key={step.label} delay={i * 0.15}>
                  <div className="relative rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-6 text-center h-full">
                    {i < LEARNING_LOOP_STEPS.length - 1 && (
                      <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                        <ArrowRight className="h-4 w-4 text-muted-foreground/20" />
                      </div>
                    )}
                    <div
                      className={`w-12 h-12 rounded-xl ${step.bgColor} flex items-center justify-center mx-auto mb-4 ring-1 ring-inset ring-white/5`}
                    >
                      <step.icon className={`h-6 w-6 ${step.color}`} />
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground/40 mb-1 uppercase tracking-wider">
                      Step {i + 1}
                    </p>
                    <h3 className="text-sm font-semibold mb-2">{step.label}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </FadeInSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Core Features ──────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-transparent via-[oklch(0.10_0.01_260/0.6)] to-transparent relative z-10">
        <div className="px-5 md:px-8 lg:px-12 max-w-7xl mx-auto">
          <FadeInSection className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground/50 mb-3 font-medium">
              Everything you need
            </p>
            <h2 className="text-2xl md:text-3xl font-bold">
              Built for real developers
            </h2>
          </FadeInSection>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {CORE_FEATURES.map((feature, i) => (
              <FadeInSection key={feature.title} delay={i * 0.08}>
                <div
                  className={`rounded-xl border ${feature.borderColor} bg-card/30 backdrop-blur-sm p-5 md:p-6 hover:border-primary/20 transition-all hover:-translate-y-0.5 h-full`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center mb-3 ring-1 ring-inset ring-white/5`}
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
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof / trust ─────────────────────────────────────── */}
      <section className="py-16 md:py-20 relative z-10">
        <div className="px-5 md:px-8 max-w-4xl mx-auto">
          <FadeInSection>
            <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/60 to-card/30 backdrop-blur-sm p-8 md:p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-[oklch(0.65_0.20_280)]/5" />
              <div className="relative z-10">
                <div className="flex justify-center gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <CheckCircle2 key={i} className="h-5 w-5 text-primary" />
                  ))}
                </div>
                <blockquote className="text-lg md:text-xl font-medium mb-4 leading-relaxed">
                  "CodeForge doesn't just generate code — it{" "}
                  <span className="text-primary">understands</span> your
                  project, learns from mistakes, and gets better every time."
                </blockquote>
                <p className="text-sm text-muted-foreground">
                  Built by developers, for developers who want to ship faster.
                </p>
              </div>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section className="py-20 md:py-28 relative z-10">
        <div className="px-5 md:px-8 max-w-2xl mx-auto text-center">
          <FadeInSection>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-medium mb-6">
              <Globe className="h-3 w-3" />
              Free to start
            </div>
            <h2 className="text-2xl md:text-4xl font-bold mb-4">
              Ready to build with an AI swarm that{" "}
              <span className="bg-gradient-to-r from-primary to-[oklch(0.65_0.20_280)] bg-clip-text text-transparent">
                never forgets a mistake?
              </span>
            </h2>
            <p className="text-muted-foreground mb-8 text-sm md:text-base">
              Import your first repo in 60 seconds. The agents take it from
              there.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow"
                onClick={() => navigate("/signup")}
              >
                Start Building Free
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-border/50"
                onClick={() => navigate("/pricing")}
              >
                View Pricing
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/50 mt-6">
              Lifetime plan is Bring Your Own Key — supply your AI provider API
              key and we'll never charge you for compute.
            </p>
          </FadeInSection>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/30 py-8 relative z-10">
        <div className="px-5 md:px-8 max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Code2 className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">
                CodeForge v2
              </span>
              <span className="hidden sm:inline">
                — AI agents that learn from every failure
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
              <a
                href="/pricing"
                className="hover:text-foreground transition-colors"
              >
                Pricing
              </a>
              <a
                href="/login"
                className="hover:text-foreground transition-colors"
              >
                Sign In
              </a>
              <a
                href="/signup"
                className="hover:text-foreground transition-colors"
              >
                Get Started
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
