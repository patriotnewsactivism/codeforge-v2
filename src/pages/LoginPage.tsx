import { motion } from "framer-motion";
import { Code2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { SignIn } from "@/components/SignIn";
import { TestUserLoginSection } from "@/components/TestUserLoginSection";

export function LoginPage() {
  return (
    <div className="min-h-[calc(100dvh-64px)] flex items-center justify-center p-4 relative">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
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
          <h1 className="text-xl font-bold mb-1">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your account to continue building
          </p>
        </div>

        <SignIn />

        <TestUserLoginSection />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center mt-6"
        >
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              to="/signup"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Create one free
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
          <span>AI-powered development platform</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
