import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Tick every 5 minutes; the internal action checks each project's
// autoIntervalMinutes and only fires runAutonomousCycle when the interval has
// elapsed. This replaces the client-side setInterval in IDEPage — now runs even
// when no browser tab is open.
//
// A per-minute tick previously exhausted the Convex free-tier quota (1440
// ticks/day plus every launched cycle's agent fan-out), which disabled the
// whole deployment. 5-minute granularity is well below the per-project minimum
// interval enforced in tickAutonomousCycles, so no scheduling precision is lost.
crons.interval(
  "autonomous-cycle-tick",
  { minutes: 5 },
  internal.suggestions.tickAutonomousCycles,
  {},
);

// Self-healing: check for new error incidents every 5 minutes and dispatch
// autonomous fixes via the ACSE execution pipeline.
crons.interval(
  "monitor-and-heal",
  { minutes: 5 },
  internal.reflection.tickMonitorAndHeal,
  {},
);

// Nightly reflection: review pending mutations, extract lessons, update memories.
// Runs at 03:00 UTC daily (off-peak).
crons.daily(
  "nightly-reflection",
  { hourUTC: 3, minuteUTC: 0 },
  internal.reflection.tickNightlyReflection,
  {},
);

// Weekly strategy: evaluate agent topology, recommend improvements.
// Runs every 168 hours (7 days).
crons.interval(
  "weekly-strategy",
  { hours: 168 },
  internal.reflection.tickWeeklyStrategy,
  {},
);

// Task queue scheduler: dispatch queued tasks respecting concurrency limits
// and dependency ordering. Runs every 10 seconds.
crons.interval(
  "task-queue-scheduler",
  { seconds: 10 },
  (internal as any).taskQueue.schedulerTick,
  {},
);

export default crons;
