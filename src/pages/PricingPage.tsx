import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, Zap, Crown, Calendar, Clock, Sparkles,
  Shield, Bot, Cpu, FolderOpen, ArrowRight, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    key: "free" as const,
    name: "Free",
    price: "$0",
    period: "forever",
    icon: <Sparkles className="h-5 w-5" />,
    color: "border-border",
    badge: null,
    features: [
      "25 AI requests / day",
      "3 missions / day",
      "2 concurrent agents",
      "3 projects",
      "Community support",
    ],
    cta: "Get Started",
    ctaVariant: "outline" as const,
  },
  {
    key: "weekly" as const,
    name: "Weekly Pro",
    price: "$9.99",
    period: "/ week",
    icon: <Clock className="h-5 w-5" />,
    color: "border-blue-500/40",
    badge: null,
    features: [
      "200 AI requests / day",
      "20 missions / day",
      "5 concurrent agents",
      "10 projects",
      "$5 / week compute cap",
      "Priority support",
    ],
    cta: "Start Weekly",
    ctaVariant: "default" as const,
  },
  {
    key: "monthly" as const,
    name: "Monthly Pro",
    price: "$29.99",
    period: "/ month",
    icon: <Calendar className="h-5 w-5" />,
    color: "border-violet-500/60",
    badge: "Most Popular",
    features: [
      "500 AI requests / day",
      "50 missions / day",
      "10 concurrent agents",
      "25 projects",
      "$15 / month compute cap",
      "Priority support",
      "Early feature access",
    ],
    cta: "Start Monthly",
    ctaVariant: "default" as const,
  },
  {
    key: "lifetime" as const,
    name: "Lifetime Founder",
    price: "$299",
    period: "one-time",
    icon: <Crown className="h-5 w-5" />,
    color: "border-amber-500/60",
    badge: "First 50 Only",
    features: [
      "1,000 AI requests / day",
      "100 missions / day",
      "20 concurrent agents",
      "100 projects",
      "$50 / 30-day compute cap",
      "VIP support & Discord",
      "All future features",
      "Founder badge",
    ],
    cta: "Get Lifetime Access",
    ctaVariant: "gold" as const,
  },
];

export function PricingPage() {
  const { isAuthenticated } = useConvexAuth();
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const createCheckout = useAction(api.stripe.createCheckoutSession);

  const handleCheckout = async (plan: "weekly" | "monthly" | "lifetime") => {
    setCheckoutLoading(plan);
    setCheckoutError(null);
    try {
      const { url } = await createCheckout({ plan });
      window.location.href = url;
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      setCheckoutLoading(null);
    }
  };
  const userPlan = useQuery(api.stripe.getUserPlan);
  const createCheckout = useAction(api.stripe.createCheckoutSession);
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpgrade = async (planKey: "weekly" | "monthly" | "lifetime") => {
    if (!isAuthenticated) {
      navigate("/signup?next=/pricing");
      return;
    }
    setLoading(planKey);
    try {
      const result = await createCheckout({
        plan: planKey,
        userId: userPlan?.userId as string | undefined,
      });
      window.location.href = result.url;
    } catch (e) {
      console.error("Checkout error:", e);
      alert("Couldn't start checkout. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="text-center pt-20 pb-12 px-4">
        <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-3 py-1 text-xs font-semibold text-violet-400 mb-6">
          <Zap className="h-3 w-3" /> Launch Pricing
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
          Build faster with AI agents
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Every plan includes the full CodeForge IDE, autonomous agents, and GitHub integration.
          No hidden fees — hard spend caps protect you.
        </p>
      </div>

      {/* Plan Cards */}
      <div className="max-w-6xl mx-auto px-4 pb-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = userPlan?.planKey === plan.key;
          const isLoading = loading === plan.key;

          return (
            <div
              key={plan.key}
              className={cn(
                "relative rounded-2xl border-2 bg-card p-6 flex flex-col gap-4 transition-all duration-200",
                plan.color,
                plan.key === "monthly" && "ring-2 ring-violet-500/30 shadow-lg shadow-violet-500/10",
                plan.key === "lifetime" && "shadow-lg shadow-amber-500/10"
              )}
            >
              {/* Badge */}
              {plan.badge && (
                <div className={cn(
                  "absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                  plan.key === "monthly" && "bg-violet-500 text-white",
                  plan.key === "lifetime" && "bg-amber-500 text-black",
                )}>
                  {plan.badge}
                </div>
              )}

              {/* Plan header */}
              <div className="flex items-center gap-2">
                <span className={cn(
                  "p-1.5 rounded-lg",
                  plan.key === "free" && "bg-muted text-muted-foreground",
                  plan.key === "weekly" && "bg-blue-500/10 text-blue-400",
                  plan.key === "monthly" && "bg-violet-500/10 text-violet-400",
                  plan.key === "lifetime" && "bg-amber-500/10 text-amber-400",
                )}>
                  {plan.icon}
                </span>
                <span className="font-bold">{plan.name}</span>
              </div>

              {/* Price */}
              <div>
                <span className="text-4xl font-black">{plan.price}</span>
                <span className="text-muted-foreground text-sm ml-1">{plan.period}</span>
              </div>

              {/* Features */}
              <ul className="space-y-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <div className="w-full py-2.5 rounded-xl text-center text-sm font-semibold bg-muted text-muted-foreground">
                  ✓ Current Plan
                </div>
              ) : plan.key === "free" ? (
                <button
                  type="button"
                  onClick={() => navigate(isAuthenticated ? "/dashboard" : "/signup")}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-muted transition-colors"
                >
                  {isAuthenticated ? "Go to Dashboard" : "Get Started Free"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan.key as any)}
                  disabled={isLoading}
                  className={cn(
                    "w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all",
                    plan.key === "monthly" && "bg-violet-600 hover:bg-violet-500 text-white shadow-md",
                    plan.key === "weekly" && "bg-blue-600 hover:bg-blue-500 text-white",
                    plan.key === "lifetime" && "bg-amber-500 hover:bg-amber-400 text-black font-black shadow-md",
                    isLoading && "opacity-60 cursor-not-allowed"
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {plan.cta}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Trust Row */}
      <div className="max-w-3xl mx-auto px-4 pb-20 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
        {[
          { icon: <Shield className="h-6 w-6 text-green-400" />, title: "Hard Spend Caps", desc: "You physically cannot be charged more than your plan cap. Period." },
          { icon: <Bot className="h-6 w-6 text-violet-400" />, title: "Real Autonomous Agents", desc: "Agents think, write code, and fix bugs in a real loop — not scripted flows." },
          { icon: <Cpu className="h-6 w-6 text-blue-400" />, title: "Cancel Anytime", desc: "No lock-in on weekly or monthly. Cancel from your settings in 10 seconds." },
        ].map((item) => (
          <div key={item.title} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border">
            {item.icon}
            <div className="font-semibold text-sm">{item.title}</div>
            <div className="text-xs text-muted-foreground leading-relaxed">{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
