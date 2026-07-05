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

export default crons;
