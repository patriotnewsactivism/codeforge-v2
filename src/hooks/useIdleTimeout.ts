import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * useIdleTimeout — signs out the user after 30 minutes of inactivity.
 * Resets on mouse movement, key presses, or scroll.
 */
export function useIdleTimeout() {
  const { signOut } = useAuthActions();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const resetTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        toast.info("Session expired due to inactivity", {
          description: "For security, you have been signed out.",
        });
        signOut();
      }, IDLE_TIMEOUT_MS);
    };

    // Events to track activity
    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    
    // Initial start
    resetTimeout();

    for (const event of events) {
      window.addEventListener(event, resetTimeout);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const event of events) {
        window.removeEventListener(event, resetTimeout);
      }
    };
  }, [signOut]);
}
