# Pricing Page Copy Updates — BYOK Distinction

## PricingPage.tsx — Lifetime card changes

### Feature list addition (add to lifetime features array):
```tsx
// Add this to the lifetime plan features array in PLANS constant:
{ text: "Bring Your Own Key (BYOK) — use your own AI credits", locked: false },
// Change/remove this line:
// { text: "$50 compute / month included", locked: false },  ← REMOVE THIS
// Replace with:
{ text: "No API compute charges from CodeForge", locked: false },
```

### Lifetime card description / subheading — find the lifetime card render and update:
```tsx
// Add below the price/period display for the lifetime card:
<p className="text-xs text-amber-400/80 mt-1">
  BYOK — bring your own AI provider key
</p>
```

### Add a callout box inside the lifetime card (below features list):
```tsx
<div className="rounded-md p-3 text-xs" style={{
  background: "rgba(245,158,11,0.08)",
  border: "1px solid rgba(245,158,11,0.2)",
  color: "#94A3B8"
}}>
  <span className="text-amber-400 font-semibold">BYOK:</span>{" "}
  Lifetime access includes unlimited usage of CodeForge — you supply your own 
  OpenAI, DeepSeek, xAI, or Moonshot API key. No compute costs billed by us.
</div>
```

---

## LandingPage.tsx — Lifetime messaging

Find any mention of "lifetime" features and add:

```tsx
// In the pricing/CTA section or wherever lifetime is mentioned:
<p className="text-sm text-slate-400">
  * Lifetime plan is Bring Your Own Key — supply your AI provider API key 
  and we'll never charge you for compute.
</p>
```

---

## Feature card for BYOK on landing (optional — add to CORE_FEATURES or V2_FEATURES):
```tsx
{
  icon: KeyRound,
  badge: "Lifetime",
  badgeColor: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  title: "Bring Your Own Key",
  description:
    "Lifetime license holders plug in their own OpenAI, DeepSeek, xAI, or Kimi key. " +
    "You own your AI costs — no markup, no surprise bills. " +
    "Weekly/Monthly plans include shared compute.",
  color: "text-amber-400",
  bgColor: "bg-amber-400/10",
}
```
