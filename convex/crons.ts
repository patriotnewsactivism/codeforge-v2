import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ─── DISABLED: AI-heavy crons that exhaust free-tier rate limits ──────────
// Re-enable once paid AI provider quotas are configured.
//
// crons.interval(
//   "autonomous-cycle-tick",
//   { minutes: 5 },
//   internal.suggestions.tickAutonomousCycles,
//   {},
// );
//
// crons.interval(
//   "monitor-and-heal",
//   { minutes: 5 },
//   internal.reflection.tickMonitorAndHeal,
//   {},
// );
//
// crons.daily(
//   "nightly-reflection",
//   { hourUTC: 3, minuteUTC: 0 },
//   internal.reflection.tickNightlyReflection,
//   {},
// );
//
// crons.interval(
//   "weekly-strategy",
//   { hours: 168 },
//   internal.reflection.tickWeeklyStrategy,
//   {},
// );

// Task queue scheduler: dispatch queued tasks respecting concurrency limits
// and dependency ordering. Runs every 30 seconds.
crons.interval(
  "task-queue-scheduler",
  { seconds: 30 },
  (internal as any).taskQueue.schedulerTick,
  {},
);

export default crons;
