# codeforge-orchestrator cutover

The current orchestrator already isolates its Convex dependency behind an HTTP client. The
`cutover-to-postgres-api.mjs` script keeps the existing endpoint contract but changes its base URL
from `CONVEX_URL` to the private Railway `CODEFORGE_API_URL`.

Copy `orchestrator/scripts/*` into the `codeforge-orchestrator/scripts/` directory, then run the
cutover script from that repository. The CodeForge application bundle provides the matching
`/api/swarm/*`, `/api/memory/*`, `/api/retrospective/*`, `/api/agents/*`, `/api/rag/*`, and
`/api/git/*` PostgreSQL-backed endpoints.

Use the same `RAILWAY_ORCHESTRATOR_SECRET` in `codeforge-app` and the private orchestrator service.
