import { motion } from "framer-motion";
import { Bug, Sparkles, Code2, Paintbrush } from "lucide-react";

interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  prompt: string;
}

const ACTIONS: QuickAction[] = [
  {
    id: "explain",
    label: "Explain Code",
    icon: Code2,
    prompt: "Please explain what this code does and how it works.",
  },
  {
    id: "fix",
    label: "Find Bugs",
    icon: Bug,
    prompt: "Review this code for bugs, edge cases, and security issues.",
  },
  {
    id: "refactor",
    label: "Refactor",
    icon: Paintbrush,
    prompt: "Refactor this code to be cleaner, more maintainable, and follow best practices.",
  },
  {
    id: "optimize",
    label: "Optimize",
    icon: Sparkles,
    prompt: "Optimize this code for better performance and efficiency.",
  },
];

interface QuickActionsProps {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export function QuickActions({ onSelect, disabled }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-3 py-2">
      {ACTIONS.map((action, i) => (
        <motion.button
          key={action.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => onSelect(action.prompt)}
          disabled={disabled}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/30 hover:bg-muted/50 border border-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <action.icon className="h-3.5 w-3.5" />
          <span>{action.label}</span>
        </motion.button>
      ))}
    </div>
  );
}
