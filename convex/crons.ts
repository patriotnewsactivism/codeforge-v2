import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Tick every minute; the internal action checks each project's autoIntervalMinutes
// and only fires runAutonomousCycle when the interval has elapsed.
// This replaces the client-side setInterval in IDEPage — now runs even when
// no browser tab is open.
crons.interval(
  "autonomous-cycle-tick",
  { minutes: 1 },
  internal.suggestions.tickAutonomousCycles,
  {},
);

export default crons;
