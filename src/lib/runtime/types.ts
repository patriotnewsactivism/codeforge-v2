/**
 * Runtime abstraction — the single interface the IDE talks to for running a
 * user's generated project. The IDE doesn't care *where* the code runs; it
 * just asks a provider to start the project and give back a preview URL + logs.
 *
 * Two engines implement this contract:
 *   - WebContainerRuntime  (client-side, in-browser Node — default, $0/session)
 *   - ServerContainerRuntime (server-side Linux VM — Phase 2, paid/on-demand)
 *
 * Routing (see `detectProjectKind`) keeps things lean: the common case
 * (static HTML or a Node/Vite app) runs in the browser for free, and the
 * expensive server engine is only ever reached when a project genuinely
 * needs it (Python/Go/Docker) — which can be gated behind a paid plan.
 */

export type ProjectKind = "static" | "node" | "server";

export interface RuntimeFile {
  /** Project-relative path, e.g. "src/main.tsx" (no leading slash). */
  path: string;
  content: string;
}

export type RuntimePhase =
  | "idle"
  | "booting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export interface RuntimeStatus {
  phase: RuntimePhase;
  /** Human-readable detail for the current phase. */
  message?: string;
  /** Live preview URL, present once phase === "ready". */
  url?: string;
}

export interface RuntimeStartOptions {
  /** Streams stdout/stderr lines from install/dev processes. */
  onLog: (line: string) => void;
  /** Reports lifecycle transitions (booting → installing → ready/error). */
  onStatus: (status: RuntimeStatus) => void;
}

export interface RuntimeProvider {
  /** Engine identifier, e.g. "webcontainer" | "server". */
  readonly kind: string;
  /** Boot the engine, mount files, install deps, and start the dev server. */
  start(files: RuntimeFile[], options: RuntimeStartOptions): Promise<void>;
  /** Push changed files into a running engine (hot reload handles the rest). */
  updateFiles(files: RuntimeFile[]): Promise<void>;
  /** Stop processes and release the engine. */
  teardown(): Promise<void>;
}

function normalize(path: string): string {
  return path.replace(/^\.?\//, "");
}

/**
 * Decide which engine a project needs.
 *   - "node":   has a package.json → real install + dev server (WebContainers)
 *   - "server": needs a non-Node toolchain (Python/Go/Rust/Docker) → Phase 2
 *   - "static": plain HTML/CSS/JS → cheap iframe preview
 */
export function detectProjectKind(files: { path: string }[]): ProjectKind {
  const paths = files.map(f => normalize(f.path));
  const has = (p: string) => paths.includes(p);
  const hasExt = (ext: string) => paths.some(p => p.endsWith(ext));

  // Non-Node toolchains require the server-side sandbox.
  if (
    has("requirements.txt") ||
    has("pyproject.toml") ||
    has("go.mod") ||
    has("Cargo.toml") ||
    has("Dockerfile") ||
    hasExt(".py") ||
    hasExt(".go") ||
    hasExt(".rs")
  ) {
    // If it also has a package.json it's likely a JS app with a stray script;
    // prefer the Node engine in that case.
    if (!has("package.json")) return "server";
  }

  if (has("package.json")) return "node";
  return "static";
}

/** Parse the best "dev" command from a package.json's scripts. */
export function pickDevScript(packageJsonContent: string | undefined): string {
  if (!packageJsonContent) return "dev";
  try {
    const pkg = JSON.parse(packageJsonContent) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    if (scripts.dev) return "dev";
    if (scripts.start) return "start";
    if (scripts.serve) return "serve";
    if (scripts.preview) return "preview";
  } catch {
    // Malformed package.json — fall back to the conventional script.
  }
  return "dev";
}
