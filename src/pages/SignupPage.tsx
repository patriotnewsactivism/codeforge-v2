import { motion } from "framer-motion";
import { Code2, Sparkles, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { SignUp } from "@/components/SignUp";

export function SignupPage() {
  return (
    <div className="min-h-[calc(100dvh-64px)] flex items-center justify-center p-4 relative">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[oklch(0.65_0.20_280)]/5 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <div className="relative">
              <Code2 className="h-6 w-6 text-primary" />
              <div className="absolute -inset-1 bg-primary/20 rounded-full blur-sm" />
            </div>
            <span className="font-bold text-xl">CodeForge</span>
          </Link>
          <h1 className="text-xl font-bold mb-1">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            Start building software with autonomous AI agents
          </p>
        </div>

        {/* Value props */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-wrap justify-center gap-2 mb-6"
        >
          {["Free to start", "No credit card", "Instant setup"].map(
            text => (
              <span
                key={text}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/5 border border-primary/10 text-[10px] text-primary/80"
              >
                <Zap className="h-2.5 w-2.5" />
                {text}
              </span>
            ),
          )}
        </motion.div>

        <SignUp />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center mt-6"
        >
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Sign in
            </Link>
          </p>
        </motion.div>

        {/* Trust badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-1.5 mt-6 text-[11px] text-muted-foreground/50"
        >
          <Sparkles className="h-3 w-3" />
          <span>Describe your idea — CodeForge builds it</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
